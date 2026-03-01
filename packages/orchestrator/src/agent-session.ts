import { spawn, execSync, type ChildProcess } from "child_process";
import path from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { previewServer } from "./preview-server.js";
import { nanoid } from "nanoid";
import type { AIBackend } from "./ai-backend.js";
import type { AgentStatus, TaskResultPayload, OrchestratorEvent } from "./types.js";

/* ── Persist session IDs across restarts ────────────────────────── */
const SESSION_FILE = path.join(homedir(), ".bit-office", "agent-sessions.json");

function loadSessionMap(): Record<string, string> {
  try {
    if (existsSync(SESSION_FILE)) return JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
  } catch { /* corrupt file, start fresh */ }
  return {};
}

function saveSessionId(agentId: string, sessionId: string | null) {
  const dir = path.dirname(SESSION_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const map = loadSessionMap();
  if (sessionId) {
    map[agentId] = sessionId;
  } else {
    delete map[agentId];
  }
  writeFileSync(SESSION_FILE, JSON.stringify(map), "utf-8");
}

interface PendingApproval {
  approvalId: string;
  resolve: (decision: "yes" | "no") => void;
}

/** Callback for delegation: (fromAgentId, targetName, prompt) => void */
export type DelegationHandler = (fromAgentId: string, targetName: string, prompt: string) => void;

/** Callback when a task completes: (agentId, taskId, summary, success) => void */
export type TaskCompleteHandler = (agentId: string, taskId: string, summary: string, success: boolean) => void;

interface QueuedTask {
  taskId: string;
  prompt: string;
  repoPath?: string;
  teamContext?: string;
}

export interface AgentSessionOpts {
  agentId: string;
  name: string;
  role: string;
  personality?: string;
  workspace: string;
  resumeHistory?: boolean;
  backend: AIBackend;
  sandboxMode?: "full" | "safe";
  onEvent: (event: OrchestratorEvent) => void;
  renderPrompt: (templateName: string, vars: Record<string, string | undefined>) => string;
  /** Whether this agent is the team lead (uses leader template, no tools) */
  isTeamLead?: boolean;
  teamId?: string;
}

export class AgentSession {
  readonly agentId: string;
  readonly name: string;
  readonly role: string;
  readonly personality: string;
  readonly backend: AIBackend;
  palette?: number;
  private process: ChildProcess | null = null;
  private currentTaskId: string | null = null;
  private taskTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private currentCwd: string | null = null;
  private _status: AgentStatus = "idle";
  get status(): AgentStatus { return this._status; }
  private pendingApprovals = new Map<string, PendingApproval>();
  private workspace: string;
  private sandboxMode: "full" | "safe";
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private hasHistory: boolean;
  private sessionId: string | null;
  private taskQueue: QueuedTask[] = [];
  private onEvent: (event: OrchestratorEvent) => void;
  private _renderPrompt: (templateName: string, vars: Record<string, string | undefined>) => string;
  private timedOut = false;
  private _isTeamLead: boolean;
  private _lastResult: string | null = null;
  /** Original user-facing task prompt (for leader state-summary mode) */
  originalTask: string | null = null;
  onDelegation: DelegationHandler | null = null;
  onTaskComplete: TaskCompleteHandler | null = null;
  /** Whether the last failure was a timeout (not retryable) */
  get wasTimeout(): boolean { return this.timedOut; }
  get isTeamLead(): boolean { return this._isTeamLead; }
  /** Short summary of last completed/failed task (for roster context) */
  get lastResult(): string | null { return this._lastResult; }
  private _lastResultText: string | null = null;
  set isTeamLead(v: boolean) { this._isTeamLead = v; }

  /** Current working directory of the running task (used by worktree logic) */
  get currentWorkingDir(): string | null { return this.currentCwd; }

  /** PID of the running child process (null if not running) */
  get pid(): number | null { return this.process?.pid ?? null; }

  /** Worktree path if task is running in one (set externally by orchestrator) */
  worktreePath: string | null = null;
  worktreeBranch: string | null = null;
  teamId?: string;

  constructor(opts: AgentSessionOpts) {
    this.agentId = opts.agentId;
    this.name = opts.name;
    this.role = opts.role;
    this.personality = opts.personality ?? "";
    this.workspace = opts.workspace;
    this.sessionId = loadSessionMap()[opts.agentId] ?? null;
    this.hasHistory = opts.resumeHistory ?? !!this.sessionId;
    this.backend = opts.backend;
    this.sandboxMode = opts.sandboxMode ?? "full";
    this._isTeamLead = opts.isTeamLead ?? false;
    this.teamId = opts.teamId;
    this.onEvent = opts.onEvent;
    this._renderPrompt = opts.renderPrompt;
  }

  async runTask(taskId: string, prompt: string, repoPath?: string, teamContext?: string, isUserInitiated = false) {
    // If the user explicitly cancelled this agent, block any automatic restarts
    // (from flushResults, delegation, retry). Only a direct user action clears this.
    if (this._userCancelled && !isUserInitiated) {
      console.log(`[Agent ${this.name}] Ignoring internal task restart — agent was cancelled by user`);
      return;
    }
    if (isUserInitiated) {
      this._userCancelled = false;
    }

    if (this.process) {
      const position = this.taskQueue.length + 1;
      this.taskQueue.push({ taskId, prompt, repoPath, teamContext });
      this.onEvent({
        type: "task:queued",
        agentId: this.agentId,
        taskId,
        prompt,
        position,
      });
      return;
    }

    // Cancel any pending idle timer from a previous task
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }

    this.currentTaskId = taskId;
    const cwd = repoPath ?? this.workspace;
    this.currentCwd = cwd;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    this.onEvent({
      type: "task:started",
      agentId: this.agentId,
      taskId,
      prompt,
    });

    this.setStatus("working");

    try {
      const cleanEnv = { ...process.env };
      for (const key of this.backend.deleteEnv ?? []) {
        delete cleanEnv[key];
      }
      // isTeamLead: uses leader template + no tools (only delegates)
      // teamContext: just the roster string (any agent in a team may see it)
      const templateVars = {
        name: this.name,
        role: this._isTeamLead ? "Team Lead" : this.role,
        personality: this.personality ? `${this.personality}` : "",
        teamRoster: teamContext ?? "",
        originalTask: this._isTeamLead ? (this.originalTask ?? prompt) : "",
        prompt,
      };
      let fullPrompt: string;
      if (this._isTeamLead) {
        fullPrompt = this._renderPrompt(this.hasHistory ? "leader-continue" : "leader-initial", templateVars);
      } else {
        fullPrompt = this._renderPrompt(this.hasHistory ? "worker-continue" : "worker-initial", templateVars);
      }
      const fullAccess = this.sandboxMode === "full";
      const verbose = !!process.env.DEBUG;
      const args = this.backend.buildArgs(fullPrompt, {
        continue: this.hasHistory,
        resumeSessionId: this.sessionId ?? undefined,
        fullAccess,
        noTools: this._isTeamLead,
        model: this._isTeamLead ? "sonnet" : undefined,
        verbose,
        skipResume: this._isTeamLead && this.hasHistory,
      });

      // Log which binary + env state
      try {
        const whichPath = execSync(`which ${this.backend.command}`, { env: cleanEnv, encoding: "utf-8", timeout: 3000 }).trim();
        console.log(`[Agent ${this.name}] Binary: ${whichPath}, CLAUDECODE=${cleanEnv.CLAUDECODE ?? "unset"}, ENTRYPOINT=${cleanEnv.CLAUDE_CODE_ENTRYPOINT ?? "unset"}`);
      } catch { /* ignore */ }
      console.log(`[Agent ${this.name}] Spawning: ${this.backend.command} ${args.map(a => a.length > 80 ? a.slice(0, 80) + '...' : a).join(' ')}`);

      // stdin MUST be "ignore" — "pipe" causes Claude Code to hang waiting for input
      // detached: true creates a new process group so we can kill the entire tree on cancel
      this.process = spawn(this.backend.command, args, {
        cwd,
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      // Task timeout: leader 3 min (delegation planning), worker 8 min (real coding)
      // Use SIGKILL (not SIGTERM) — Claude CLI ignores SIGTERM while waiting on API calls
      this.timedOut = false;
      const TASK_TIMEOUT_MS = this._isTeamLead ? 3 * 60 * 1000 : 8 * 60 * 1000;
      this.taskTimeout = setTimeout(() => {
        if (this.process?.pid) {
          console.log(`[Agent ${this.agentId}] Task timed out after ${TASK_TIMEOUT_MS / 1000}s, killing`);
          this.timedOut = true;
          try { process.kill(-this.process.pid, "SIGKILL"); } catch { this.process.kill("SIGKILL"); }
        }
      }, TASK_TIMEOUT_MS);

      // Delegation detection regex
      const DELEGATION_RE = /^\s*(?:[-*>]\s*)?(?:\*\*)?@(\w+)(?:\*\*)?:\s*(.+)$/;

      // Filter out system/diagnostic noise that should not appear in the UI
      const isSystemNoise = (line: string): boolean => {
        const t = line.trim().toLowerCase();
        if (!t) return true;
        // MCP-related
        if (t.includes("mcp") && (t.startsWith("[") || t.includes("server") || t.includes("connect") || t.includes("tool"))) return true;
        // Claude Code internal diagnostics
        if (/^\s*>?\s*(fetching|loaded|reading|writing|searching|running|executing|checking)\s/i.test(line)) return true;
        // Progress indicators / spinners
        if (/^[\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗•·…\-]+$/.test(line.trim())) return true;
        // Bare file path lines (no sentence content)
        if (/^\s*[\w./\\-]+\.(ts|tsx|js|jsx|json|md|css|py)\s*$/.test(line)) return true;
        return false;
      };

      // Handle a line of plain text output (delegation detection + logging)
      const handleTextLine = (text: string) => {
        const lines = text.split("\n").filter((l) => l.trim());
        const visibleLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          console.log(`[Agent ${this.name}] ${trimmed.slice(0, 200)}`);
          const match = trimmed.match(DELEGATION_RE);
          if (match && this.onDelegation) {
            const [, targetName, delegatedPrompt] = match;
            console.log(`[Delegation detected] ${this.name} -> @${targetName}: ${delegatedPrompt.slice(0, 60)}`);
            this.onDelegation(this.agentId, targetName, delegatedPrompt.replace(/\*\*$/, "").trim());
          }
          if (!isSystemNoise(line)) {
            visibleLines.push(trimmed);
          }
        }
        if (visibleLines.length > 0) {
          this.onEvent({
            type: "log:append",
            agentId: this.agentId,
            taskId,
            stream: "stdout",
            chunk: visibleLines.slice(-3).join("\n"),
          });
        }
      };

      // Parse stream-json or plain text stdout
      let jsonLineBuf = "";
      let stdoutChunkCount = 0;
      let seenFirstJson = false;
      this.process.stdout?.on("data", (data: Buffer) => {
        const raw = data.toString();
        stdoutChunkCount++;
        if (stdoutChunkCount <= 3) {
          console.log(`[Agent ${this.name} raw-stdout #${stdoutChunkCount}] ${raw.slice(0, 150)}`);
        }
        jsonLineBuf += raw;

        // Process complete lines
        let nlIdx: number;
        while ((nlIdx = jsonLineBuf.indexOf("\n")) !== -1) {
          const line = jsonLineBuf.slice(0, nlIdx).trim();
          jsonLineBuf = jsonLineBuf.slice(nlIdx + 1);
          if (!line) continue;

          // Try to parse as stream-json
          if (line.startsWith("{")) {
            try {
              const msg = JSON.parse(line);
              seenFirstJson = true;
              // Capture session ID for --resume on next run
              if (msg.type === "system" && msg.session_id) {
                this.sessionId = msg.session_id;
                console.log(`[Agent ${this.name}] Session ID: ${msg.session_id}`);
              }
              if (msg.type === "assistant" && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === "text" && block.text) {
                    this.stdoutBuffer += block.text + "\n";
                    handleTextLine(block.text);
                  }
                  if (block.type === "thinking" && block.thinking) {
                    console.log(`[Agent ${this.name} thinking] ${block.thinking.slice(0, 120)}...`);
                  }
                }
              } else if (msg.type === "result" && msg.result) {
                if (!this.stdoutBuffer) {
                  this.stdoutBuffer = msg.result;
                  handleTextLine(msg.result);
                }
                this._lastResultText = msg.result;
              }
              continue;
            } catch {
              // Not valid JSON, treat as plain text
            }
          }

          // First non-JSON line: this backend outputs plain text, not stream-json.
          // Switch to plain-text mode so all subsequent lines are processed.
          if (!seenFirstJson) {
            seenFirstJson = true;
          }

          // Plain text fallback (non-Claude backends)
          this.stdoutBuffer += line + "\n";
          handleTextLine(line);
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        this.stderrBuffer += chunk;
        // Log to console for debugging, but do NOT forward stderr to the UI.
        // Stderr is MCP internals, system diagnostics, and Claude Code infrastructure —
        // none of it is meaningful agent output for the user.
        for (const line of chunk.split("\n")) {
          if (line.trim()) console.log(`[Agent ${this.name} stderr] ${line.slice(0, 200)}`);
        }
      });

      this.process.on("close", (code) => {
        this.process = null;
        if (this.taskTimeout) { clearTimeout(this.taskTimeout); this.taskTimeout = null; }

        // Flush any remaining data in the JSON line buffer (last line without trailing newline)
        const remaining = jsonLineBuf.trim();
        if (remaining) {
          jsonLineBuf = "";
          for (const chunk of remaining.split("\n")) {
            const line = chunk.trim();
            if (!line) continue;
            if (line.startsWith("{")) {
              try {
                const msg = JSON.parse(line);
                if (msg.type === "assistant" && msg.message?.content) {
                  for (const block of msg.message.content) {
                    if (block.type === "text" && block.text) {
                      this.stdoutBuffer += block.text + "\n";
                      handleTextLine(block.text);
                    }
                  }
                } else if (msg.type === "result" && msg.result) {
                  this._lastResultText = msg.result;
                  if (!this.stdoutBuffer) {
                    this.stdoutBuffer = msg.result;
                    handleTextLine(msg.result);
                  }
                }
              } catch { /* not valid JSON */ }
            } else {
              seenFirstJson = true;
              this.stdoutBuffer += line + "\n";
              handleTextLine(line);
            }
          }
        }

        const completedTaskId = this.currentTaskId ?? taskId;
        this.currentTaskId = null;
        const wasCancelled = this.cancelled;
        this.cancelled = false;

        console.log(`[Agent ${this.agentId}] ${this.backend.name} exited: code=${code}, cancelled=${wasCancelled}, stdout=${this.stdoutBuffer.length}ch`);

        try {
          if (wasCancelled) {
            // Already handled in cancelTask() — just clean up and dequeue
            this.dequeueNext();
            return;
          } else if (code === 0) {
            this.hasHistory = true;
            saveSessionId(this.agentId, this.sessionId);

            const { summary, fullOutput, changedFiles } = this.extractResult();

            // Preview detection: skip for team leads (they don't create files).
            // Leader preview is handled by the orchestrator when isFinalResult is set.
            const { previewUrl, previewPath } = this._isTeamLead
              ? { previewUrl: undefined, previewPath: undefined }
              : this.detectPreview();

            this._lastResult = `done: ${summary.slice(0, 120)}`;
            this.setStatus("done");
            this.onEvent({
              type: "task:done",
              agentId: this.agentId,
              taskId: completedTaskId,
              result: { summary, fullOutput, changedFiles, diffStat: "", testResult: "unknown", previewUrl, previewPath },
            });
            this.onTaskComplete?.(this.agentId, completedTaskId, summary, true);
            this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, 5000);
          } else {
            const errorMsg = this.stdoutBuffer.slice(0, 300) || this.stderrBuffer.slice(-300) || `Process exited with code ${code}`;
            this._lastResult = `failed: ${errorMsg.slice(0, 120)}`;
            this.setStatus("error");
            this.onEvent({
              type: "task:failed",
              agentId: this.agentId,
              taskId: completedTaskId,
              error: errorMsg,
            });
            this.onTaskComplete?.(this.agentId, completedTaskId, errorMsg, false);
            this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, 3000);
          }
          this.dequeueNext();
        } catch (err) {
          console.error(`[Agent ${this.agentId}] Error in close handler:`, err);
          this.setStatus("error");
          this.dequeueNext();
        }
      });

      this.process.on("error", (err) => {
        this.process = null;
        this.currentTaskId = null;
        this.setStatus("error");
        this.onEvent({
          type: "task:failed",
          agentId: this.agentId,
          taskId,
          error: err.message,
        });
        this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, 3000);
      });
    } catch (err) {
      this.setStatus("error");
      this.onEvent({
        type: "task:failed",
        agentId: this.agentId,
        taskId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Send a message to the agent's stdin.
   * NOTE: Currently a no-op because stdin is set to "ignore" (pipe causes Claude Code to hang).
   * Future: use --input-format stream-json for bidirectional communication.
   */
  sendMessage(_message: string): boolean {
    // stdin is "ignore" — cannot write. See TODO above.
    return false;
  }

  /**
   * Detect preview URL/path from agent output.
   * Called directly for workers; called by orchestrator for leader's final result.
   */
  detectPreview(): { previewUrl: string | undefined; previewPath: string | undefined } {
    // 1) Explicit PREVIEW: http://... line
    const previewMatch = this.stdoutBuffer.match(/PREVIEW:\s*(https?:\/\/[^\s*)\]>]+)/i);
    let previewUrl = previewMatch?.[1]?.replace(/[*)\]>]+$/, "");
    let previewPath: string | undefined;

    // 2) Any http://localhost mention in output
    if (!previewUrl) {
      const localhostMatch = this.stdoutBuffer.match(/https?:\/\/localhost[:\d]*/);
      previewUrl = localhostMatch?.[0];
    }

    // 3) .html file path mentioned in output (SUMMARY, FILES_CHANGED, or prose)
    if (!previewUrl) {
      const fileMatch = this.stdoutBuffer.match(/(?:open\s+)?((?:\/[\w./_-]+|[\w./_-]+)\.html?)\b/i);
      if (fileMatch) {
        previewPath = path.isAbsolute(fileMatch[1])
          ? fileMatch[1]
          : path.join(this.currentCwd ?? this.workspace, fileMatch[1]);
        previewUrl = previewServer.serve(previewPath);
      }
    }

    // 4) Fallback: look for .html in changedFiles (worker may have modified but not mentioned it)
    if (!previewUrl) {
      const { changedFiles } = this.extractResult();
      const htmlFile = changedFiles.find(f => /\.html?$/i.test(f));
      if (htmlFile) {
        previewPath = path.isAbsolute(htmlFile)
          ? htmlFile
          : path.join(this.currentCwd ?? this.workspace, htmlFile);
        previewUrl = previewServer.serve(previewPath);
      }
    }

    return { previewUrl, previewPath };
  }

  /**
   * Parse stdoutBuffer for structured result (SUMMARY/STATUS/FILES_CHANGED).
   * Falls back to a cleaned-up excerpt of the raw output.
   */
  private extractResult(): { summary: string; fullOutput: string; changedFiles: string[] } {
    const raw = this.stdoutBuffer || this._lastResultText || "";
    const fullOutput = raw.slice(0, 3000);

    // Try to extract structured fields from worker output format
    const summaryMatch = raw.match(/SUMMARY:\s*(.+)/i);
    const filesMatch = raw.match(/FILES_CHANGED:\s*(.+)/i);

    const changedFiles: string[] = [];
    if (filesMatch) {
      const fileList = filesMatch[1].trim();
      for (const f of fileList.split(/[,\n]+/)) {
        const cleaned = f.trim().replace(/^[-*]\s*/, "");
        if (cleaned) changedFiles.push(cleaned);
      }
    }

    if (summaryMatch) {
      return { summary: summaryMatch[1].trim(), fullOutput, changedFiles };
    }

    // No structured SUMMARY — extract the most meaningful part
    const lines = raw.split("\n").filter(l => l.trim());
    const delegationRe = /^@(\w+):/;
    const noisePatterns = [
      /^STATUS:\s/i,
      /^FILES_CHANGED:\s/i,
      /^SUMMARY:\s/i,
      /^\[Assigned by /,
      /^mcp\s/i,
      /^╔|^║|^╚/,
      /^\s*[-*]{3,}\s*$/,
    ];

    const delegationTargets: string[] = [];
    const meaningful: string[] = [];
    for (const l of lines) {
      const trimmed = l.trim();
      const dm = trimmed.match(delegationRe);
      if (dm) {
        delegationTargets.push(dm[1]);
      } else if (!noisePatterns.some(p => p.test(trimmed))) {
        meaningful.push(l);
      }
    }

    // If output is primarily delegations (leader), summarize the delegation targets
    if (meaningful.length === 0 && delegationTargets.length > 0) {
      return { summary: `Delegated tasks to ${delegationTargets.join(", ")}`, fullOutput, changedFiles };
    }

    const lastChunk = meaningful.slice(-5).join("\n").trim();
    const summary = lastChunk.slice(0, 500) || "Task completed";

    return { summary, fullOutput, changedFiles };
  }

  private dequeueNext() {
    if (this.taskQueue.length === 0) return;
    const next = this.taskQueue.shift()!;
    setTimeout(() => {
      this.runTask(next.taskId, next.prompt, next.repoPath, next.teamContext);
    }, 100);
  }

  private cancelled = false;
  /** Set by cancelTask(); prevents flushResults / delegation from auto-restarting this agent. */
  private _userCancelled = false;

  cancelTask() {
    this.taskQueue = [];
    this._userCancelled = true;

    if (this.taskTimeout) { clearTimeout(this.taskTimeout); this.taskTimeout = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }

    const cancelledTaskId = this.currentTaskId ?? "";

    // Kill the running process if there is one
    if (this.process && this.process.pid) {
      this.cancelled = true;
      this.hasHistory = true;
      saveSessionId(this.agentId, this.sessionId);
      this.onTaskComplete?.(this.agentId, cancelledTaskId, "Task cancelled by user", false);

      const pgid = this.process.pid;
      try { process.kill(-pgid, "SIGKILL"); } catch {
        try { this.process.kill("SIGKILL"); } catch { /* already dead */ }
      }
    }

    // Always force UI reset — even if process was already gone.
    // This prevents the UI from getting stuck in "working" state.
    this._lastResult = "cancelled: Task cancelled by user";
    this.setStatus("error");
    this.onEvent({
      type: "task:failed",
      agentId: this.agentId,
      taskId: cancelledTaskId,
      error: "Task cancelled by user",
    });
    this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, 3000);
  }

  destroy() {
    if (this.taskTimeout) { clearTimeout(this.taskTimeout); this.taskTimeout = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.process?.pid) {
      const pgid = this.process.pid;
      // Use SIGKILL — CLI agents like codex/claude ignore SIGTERM
      try { process.kill(-pgid, "SIGKILL"); } catch {
        try { this.process.kill("SIGKILL"); } catch { /* already dead */ }
      }
      this.process = null;
    }
    this.pendingApprovals.clear();
    saveSessionId(this.agentId, null);
  }

  resolveApproval(approvalId: string, decision: "yes" | "no") {
    if (approvalId === "__all__") {
      for (const [, pending] of this.pendingApprovals) {
        pending.resolve(decision);
      }
      this.pendingApprovals.clear();
      return;
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.resolve(decision);
      this.pendingApprovals.delete(approvalId);
    }
  }

  async requestApproval(title: string, summary: string, riskLevel: "low" | "med" | "high"): Promise<"yes" | "no"> {
    const approvalId = nanoid();
    const taskId = this.currentTaskId ?? "unknown";

    this.setStatus("waiting_approval");

    this.onEvent({
      type: "approval:needed",
      approvalId,
      agentId: this.agentId,
      taskId,
      title,
      summary,
      riskLevel,
    });

    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, { approvalId, resolve });
    });
  }

  private setStatus(status: AgentStatus) {
    // Guard: don't downgrade to "idle" if a task is running or queued
    if (status === "idle" && (this.process || this.taskQueue.length > 0)) return;
    this._status = status;
    this.onEvent({
      type: "agent:status",
      agentId: this.agentId,
      status,
    });
  }
}
