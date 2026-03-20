import { spawn, execSync, type ChildProcess } from "child_process";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { CONFIG } from "./config.js";
import { removeWorktree } from "./worktree.js";
import { resolvePreview } from "./preview-resolver.js";
import { parseAgentOutput } from "./output-parser.js";
import { nanoid } from "nanoid";
import type { AIBackend } from "./ai-backend.js";
import type { AgentStatus, TaskResultPayload, OrchestratorEvent, LogActivityEvent } from "./types.js";
import type { TemplateName } from "./prompt-templates.js";
import { getMemoryContext, commitSession, buildRecoveryContext, getRecoveryString, saveSessionHistory } from "./memory.js";

/* ── Tool activity summarizer ──────────────────────────────────── */

function summarizeToolUse(name: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return `Using ${name}`;
  const filePath = input.file_path as string | undefined;
  const basename = filePath ? filePath.split("/").pop() : undefined;
  switch (name) {
    case "Read":
      return basename ? `Reading ${basename}` : "Reading file";
    case "Write":
      return basename ? `Writing ${basename}` : "Writing file";
    case "Edit":
      return basename ? `Editing ${basename}` : "Editing file";
    case "Grep":
      return `Searching for "${String(input.pattern ?? "").slice(0, 40)}"`;
    case "Glob":
      return `Finding files: ${String(input.pattern ?? "").slice(0, 40)}`;
    case "Bash": {
      const cmd = String(input.command ?? "").slice(0, 50);
      return cmd ? `Running: ${cmd}` : "Running command";
    }
    default:
      return `Using ${name}`;
  }
}

/* ── Persist session IDs + recovery context across restarts ───────── */

// RecoveryContext is now defined in @bit-office/memory (packages/memory/src/types.ts).
// It includes structured SessionSummary instead of raw recentMessages.
import type { RecoveryContext } from "@bit-office/memory";

/** Disk format: value is either a legacy string (sessionId) or the new object */
interface SessionEntry {
  sessionId: string;
  recovery?: RecoveryContext;
}

type SessionMap = Record<string, string | SessionEntry>;

/**
 * Session file path is instance-scoped to prevent cross-instance contamination.
 * Set via setSessionDir() from the gateway using its instanceDir config.
 * Falls back to ~/.bit-office/agent-sessions.json for backwards compatibility.
 */
let _sessionDir: string = path.join(homedir(), ".bit-office");

export function setSessionDir(dir: string) {
  _sessionDir = dir;
}

function getSessionFile(): string {
  return path.join(_sessionDir, "agent-sessions.json");
}

function loadRawMap(): SessionMap {
  try {
    const f = getSessionFile();
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf-8"));
  } catch { /* corrupt file, start fresh */ }
  return {};
}

/** Resolve a raw entry (legacy string | new object) into sessionId */
function resolveSessionId(entry: string | SessionEntry | undefined): string | null {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.sessionId ?? null;
}

/** Resolve recovery context from a raw entry */
function resolveRecovery(entry: string | SessionEntry | undefined): RecoveryContext | null {
  if (!entry || typeof entry === "string") return null;
  return entry.recovery ?? null;
}

export function loadSessionMap(): Record<string, string> {
  const raw = loadRawMap();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const sid = resolveSessionId(v);
    if (sid) result[k] = sid;
  }
  return result;
}

/** Load recovery context for a specific agent (returns null if none) */
export function loadRecoveryContext(agentId: string): RecoveryContext | null {
  return resolveRecovery(loadRawMap()[agentId]);
}

export function clearAllSessionIds() {
  try {
    writeFileSync(getSessionFile(), "{}", "utf-8");
  } catch { /* ignore */ }
}

export function clearSessionId(agentId: string) {
  saveSessionId(agentId, null);
}

function saveSessionId(agentId: string, sessionId: string | null) {
  const dir = path.dirname(getSessionFile());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const raw = loadRawMap();
  if (sessionId) {
    // Preserve existing recovery context when updating sessionId
    const existing = raw[agentId];
    const recovery = resolveRecovery(existing);
    raw[agentId] = recovery ? { sessionId, recovery } : { sessionId };
  } else {
    // Keep recovery context even when clearing sessionId (that's the point —
    // recovery is most useful precisely when the session is gone)
    const existing = raw[agentId];
    const recovery = resolveRecovery(existing);
    if (recovery) {
      raw[agentId] = { sessionId: "", recovery };
    } else {
      delete raw[agentId];
    }
  }
  writeFileSync(getSessionFile(), JSON.stringify(raw), "utf-8");
}

/** Save recovery context for an agent (called on task success) */
export function saveRecoveryContext(agentId: string, recovery: RecoveryContext) {
  const dir = path.dirname(getSessionFile());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const raw = loadRawMap();
  const existing = raw[agentId];
  const sessionId = resolveSessionId(existing) ?? "";
  raw[agentId] = { sessionId, recovery };
  writeFileSync(getSessionFile(), JSON.stringify(raw), "utf-8");
}

interface PendingApproval {
  approvalId: string;
  resolve: (decision: "yes" | "no") => void;
}

/** Callback for delegation: (fromAgentId, targetName, prompt) => void */
export type DelegationHandler = (fromAgentId: string, targetName: string, prompt: string) => void;

/** Callback when a task completes: (agentId, taskId, summary, success) => void */
export type TaskCompleteHandler = (agentId: string, taskId: string, summary: string, success: boolean, fullOutput?: string) => void;

interface QueuedTask {
  taskId: string;
  prompt: string;
  repoPath?: string;
  teamContext?: string;
  phaseOverride?: string;
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
  renderPrompt: (templateName: TemplateName, vars: Record<string, string | undefined>) => string;
  /** Whether this agent is the team lead (uses leader template, no tools) */
  isTeamLead?: boolean;
  teamId?: string;
  /** Memory context to inject into prompts (from previous projects) */
  memoryContext?: string;
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
  private taskInputTokens = 0;
  private taskOutputTokens = 0;
  /** Files actually written/edited during the current task (tracked from tool_use events) */
  private taskChangedFiles = new Set<string>();
  /** Dedup same-turn repeated usage in assistant messages */
  private lastUsageSignature = "";
  private hasHistory: boolean;
  private sessionId: string | null;
  /** Consecutive resume failures (0-output exits). Clear session only after 2+ consecutive failures. */
  private resumeFailCount = 0;
  private taskQueue: QueuedTask[] = [];
  private onEvent: (event: OrchestratorEvent) => void;
  private _renderPrompt: (templateName: TemplateName, vars: Record<string, string | undefined>) => string;
  private timedOut = false;
  private _isTeamLead: boolean;
  private _memoryContext: string;
  /** Whether this leader has already been through execute phase at least once */
  private _hasExecuted = false;
  private _lastResult: string | null = null;
  /** Original user-facing task prompt (for leader state-summary mode) */
  originalTask: string | null = null;
  onDelegation: DelegationHandler | null = null;
  onTaskComplete: TaskCompleteHandler | null = null;
  /** Whether the last failure was a timeout (not retryable) */
  get wasTimeout(): boolean { return this.timedOut; }
  get isTeamLead(): boolean { return this._isTeamLead; }
  /** Mark that this leader has already been through execute phase (for restart recovery). */
  set hasExecuted(v: boolean) { this._hasExecuted = v; }
  /** Short summary of last completed/failed task (for roster context) */
  get lastResult(): string | null { return this._lastResult; }
  private _lastResultText: string | null = null;
  /** Full output from the last completed task (for plan capture). */
  private _lastFullOutput: string | null = null;
  get lastFullOutput(): string | null { return this._lastFullOutput; }
  set isTeamLead(v: boolean) { this._isTeamLead = v; }
  /** Current phase override for team collaboration phases */
  currentPhase: string | null = null;

  /** Current working directory of the running task (used by worktree logic) */
  get currentWorkingDir(): string | null { return this.currentCwd; }
  /** Whether this agent has session history (used --resume before) */
  get hasSessionHistory(): boolean { return this.hasHistory; }
  /** The configured workspace root directory */
  get workspaceDir(): string { return this.workspace; }

  /** PID of the running child process (null if not running) */
  get pid(): number | null { return this.process?.pid ?? null; }

  /** Worktree path if task is running in one (set externally by orchestrator) */
  worktreePath: string | null = null;
  worktreeBranch: string | null = null;
  /** Use backend-native worktree isolation (e.g. Claude Code --worktree) */
  useNativeWorktree = false;
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
    this._memoryContext = opts.memoryContext ?? "";
    this.onEvent = opts.onEvent;
    this._renderPrompt = opts.renderPrompt;
  }

  async runTask(taskId: string, prompt: string, repoPath?: string, teamContext?: string, isUserInitiated = false, phaseOverride?: string) {
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
      this.taskQueue.push({ taskId, prompt, repoPath, teamContext, phaseOverride });
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
    this.currentPhase = phaseOverride ?? null;
    const cwd = repoPath ?? this.worktreePath ?? this.workspace;
    this.currentCwd = cwd;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.taskInputTokens = 0;
    this.taskOutputTokens = 0;
    this.taskChangedFiles.clear();
    this.lastUsageSignature = "";

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
      // Cap originalTask to avoid exceeding CLI argument limits (especially for non-Claude backends)
      const rawOriginalTask = this._isTeamLead ? (this.originalTask ?? prompt) : "";
      const originalTask = rawOriginalTask.length > 1500 ? rawOriginalTask.slice(0, 1500) + "\n...(truncated)" : rawOriginalTask;
      // Build recovery context string for ALL non-leader agents.
      // Always inject so that resume and app-restart scenarios retain prior-session context.
      // Uses @bit-office/memory's structured SessionSummary instead of raw message fragments.
      let recoveryContextStr = "";
      if (!this._isTeamLead) {
        const recovery = buildRecoveryContext(this.agentId, {
          originalTask: this.originalTask?.slice(0, 300),
          phase: this.currentPhase ?? undefined,
        });
        if (recovery.sessionSummary || recovery.originalTask) {
          recoveryContextStr = getRecoveryString(recovery);
        }
      }

      const templateVars = {
        name: this.name,
        role: this._isTeamLead ? "Team Lead" : this.role,
        personality: this.personality ? `${this.personality}` : "",
        teamRoster: teamContext ?? "",
        originalTask,
        prompt,
        memory: this._memoryContext || getMemoryContext(this.agentId),
        recoveryContext: recoveryContextStr,
        soloHint: this.teamId ? "" : `- You are a SOLO developer. Do NOT delegate, assign tasks, or mention other team members. Do ALL the work yourself.
- WORKSPACE: Your working directory is ${cwd}. ALL files must be created inside this directory. Do NOT create files in $HOME or any other directory.
- PROJECT DIRECTORY: When creating files, first create a dedicated project directory (short kebab-case name, e.g. "snake-game") inside your workspace. Do ALL work inside it. Report it as PROJECT_DIR: <directory-name> in your output. If the user is just chatting (no code needed), skip this.
- Before destructive operations (rm -rf, git reset, chmod), ask for approval first.
- OUTPUT DISCIPLINE: Return ONLY actionable results (code changes, file paths, findings, errors). No chain-of-thought, no step-by-step narration, no reasoning process. Maximum 5 sentences for summary. If the task produced code changes, return: files changed, what changed, any issues. Nothing else.`,
      };
      // Capture before template selection modifies it
      const isFirstExecute = this._isTeamLead && phaseOverride === "execute" && !this._hasExecuted;

      // Resolve subagent type for Claude Code (matches ~/.claude/agents/ by name field).
      // If no matching agent exists, Claude CLI silently ignores it.
      let agentType: string | undefined;
      if (this.backend.id === "claude" && !this._isTeamLead) {
        const roleName = this.role.split(/\s*[—–]\s*/)[0].trim();
        if (roleName && roleName.length > 2) {
          agentType = roleName;
        }
      }

      let fullPrompt: string;
      if (this._isTeamLead && phaseOverride && ["create", "design", "complete"].includes(phaseOverride)) {
        // Conversational phases: use continuation template if resuming, full template if first turn
        const templateName = (this.hasHistory ? `leader-${phaseOverride}-continue` : `leader-${phaseOverride}`) as TemplateName;
        fullPrompt = this._renderPrompt(templateName, templateVars);
      } else if (this._isTeamLead) {
        // First time entering execute: use leader-initial (full delegation rules)
        // Subsequent execute (feedback loop / result forwarding): use leader-continue to keep context
        const canResumeLeader = this.hasHistory && !!this.sessionId;
        const useInitial = isFirstExecute || !canResumeLeader;
        fullPrompt = this._renderPrompt(useInitial ? "leader-initial" : "leader-continue", templateVars);
        if (phaseOverride === "execute") this._hasExecuted = true;
      } else {
        let workerInitial: TemplateName;
        const isReviewer = this.role.toLowerCase().includes("review");
        if (isReviewer && agentType) {
          workerInitial = "worker-subagent-reviewer-initial";
        } else if (isReviewer) {
          workerInitial = "worker-reviewer-initial";
        } else if (agentType) {
          // Has a matching subagent — use lightweight template.
          // Dev-like roles get preview rules; non-dev roles get minimal prompt.
          const isDevRole = /developer|engineer|architect|scripter|builder|prototyper|coder/i.test(this.role);
          workerInitial = isDevRole ? "worker-subagent-dev-initial" : "worker-subagent-initial";
        } else {
          workerInitial = "worker-initial";
        }
        // Only use continue template if we have an actual session to resume
        const canResume = this.hasHistory && !!this.sessionId;
        fullPrompt = this._renderPrompt(canResume ? "worker-continue" : workerInitial, templateVars);
      }
      const fullAccess = this.sandboxMode === "full";
      const verbose = !!process.env.DEBUG;

      // IMPORTANT: Only use --resume with a specific session ID, never --continue.
      // --continue resumes the LAST Claude Code session globally, which in multi-agent
      // setups causes agent context contamination (e.g. Dev gets Kai's session).
      const args = this.backend.buildArgs(fullPrompt, {
        continue: false,
        resumeSessionId: this.sessionId ?? undefined,
        fullAccess,
        noTools: this._isTeamLead,
        verbose,
        agentType,
        // Only skip resume on first execute (to shed conversational create/design context).
        // On subsequent runs (result forwarding, user feedback), resume so leader keeps context.
        skipResume: isFirstExecute && this.hasHistory,
        worktree: this.useNativeWorktree,
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

      // Task timeout: only for team members (prevent blocking the team flow).
      // Solo agents have no timeout — user can cancel manually.
      this.timedOut = false;
      const TASK_TIMEOUT_MS = !this.teamId ? 0
        : this._isTeamLead ? CONFIG.timing.leaderTimeoutMs
        : CONFIG.timing.workerTimeoutMs;
      if (TASK_TIMEOUT_MS > 0) {
        this.taskTimeout = setTimeout(() => {
          if (this.process?.pid) {
            console.log(`[Agent ${this.agentId}] Task timed out after ${TASK_TIMEOUT_MS / 1000}s, killing`);
            this.timedOut = true;
            try { process.kill(-this.process.pid, "SIGKILL"); } catch { this.process.kill("SIGKILL"); }
          }
        }, TASK_TIMEOUT_MS);
      }

      // Delegation detection regex
      const DELEGATION_RE = /^\s*(?:[-*>]\s*)?(?:\*\*)?@(\w+)(?:\*\*)?:\s*(.+)$/;

      // Filter out system/diagnostic noise that should not appear in the UI.
      // fromStreamJson: when true, skip verb/path filters (those are only for plain-text backends).
      const isSystemNoise = (line: string, fromStreamJson = false): boolean => {
        const t = line.trim().toLowerCase();
        if (!t) return true;
        // MCP-related
        if (t.includes("mcp") && (t.startsWith("[") || t.includes("server") || t.includes("connect") || t.includes("tool"))) return true;
        // The following filters only apply to plain-text mode (non-Claude backends)
        if (!fromStreamJson) {
          // Claude Code internal diagnostics
          if (/^\s*>?\s*(fetching|loaded|reading|writing|searching|running|executing|checking)\s/i.test(line)) return true;
          // Progress indicators / spinners
          if (/^[\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗•·…\-]+$/.test(line.trim())) return true;
          // Bare file path lines (no sentence content)
          if (/^\s*[\w./\\-]+\.(ts|tsx|js|jsx|json|md|css|py)\s*$/.test(line)) return true;
        }
        return false;
      };

      // Accumulator for multi-line delegations (e.g. @Kai: Fix bugs:\n1. bug one\n2. bug two)
      let pendingDelegation: { targetName: string; lines: string[] } | null = null;

      const flushDelegation = () => {
        if (pendingDelegation && this.onDelegation) {
          const fullPrompt = pendingDelegation.lines.join("\n").replace(/\*\*$/, "").trim();
          console.log(`[Delegation detected] ${this.name} -> @${pendingDelegation.targetName}: ${fullPrompt.slice(0, 120)}`);
          this.onDelegation(this.agentId, pendingDelegation.targetName, fullPrompt);
        }
        pendingDelegation = null;
      };

      // Handle a line of plain text output (delegation detection + logging)
      // fromStreamJson: true when text comes from stream-json blocks (skip verb/path noise filters)
      const handleTextLine = (text: string, fromStreamJson = false) => {
        const lines = text.split("\n").filter((l) => l.trim());
        const visibleLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          console.log(`[Agent ${this.name}] ${trimmed.slice(0, 200)}`);
          const match = this._isTeamLead ? trimmed.match(DELEGATION_RE) : null;
          if (match) {
            // Flush any previous delegation before starting a new one
            flushDelegation();
            const [, targetName, delegatedPrompt] = match;
            pendingDelegation = { targetName, lines: [delegatedPrompt] };
          } else if (pendingDelegation) {
            // Continuation line of current delegation
            pendingDelegation.lines.push(trimmed);
          }
          if (!isSystemNoise(line, fromStreamJson)) {
            visibleLines.push(trimmed);
          }
        }
        // Flush at end of text block (covers single-delegation and last-delegation cases)
        flushDelegation();
        if (visibleLines.length > 0) {
          this.onEvent({
            type: "log:append",
            agentId: this.agentId,
            taskId,
            stream: "stdout",
            chunk: visibleLines.join("\n"),
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
              // Capture session ID for --resume on next run.
              // Save to disk immediately — if the app crashes mid-task, we need
              // this ID to resume the conversation on restart.
              if (msg.type === "system" && msg.session_id) {
                this.sessionId = msg.session_id;
                saveSessionId(this.agentId, msg.session_id);
                console.log(`[Agent ${this.name}] Session ID: ${msg.session_id}`);
              }
              if (msg.type === "assistant" && msg.message?.content) {
                // Live token usage from per-turn usage (dedup same-turn repeats)
                if (msg.message.usage) {
                  const usage = msg.message.usage;
                  const turnIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
                  const turnOut = usage.output_tokens ?? 0;
                  const sig = `${turnIn}:${turnOut}`;
                  if (sig !== this.lastUsageSignature) {
                    this.lastUsageSignature = sig;
                    this.taskInputTokens += turnIn;
                    this.taskOutputTokens += turnOut;
                    this.onEvent({
                      type: "token:update",
                      agentId: this.agentId,
                      inputTokens: this.taskInputTokens,
                      outputTokens: this.taskOutputTokens,
                    });
                  }
                }
                for (const block of msg.message.content) {
                  if (block.type === "text" && block.text) {
                    this.stdoutBuffer += block.text + "\n";
                    handleTextLine(block.text, true);
                  }
                  if (block.type === "thinking" && block.thinking) {
                    console.log(`[Agent ${this.name} thinking] ${block.thinking.slice(0, 120)}...`);
                    // Surface a one-line summary as lastLogLine so the UI shows thinking activity
                    const snippet = block.thinking.slice(0, 80).replace(/\n/g, " ").trim();
                    if (snippet) {
                      this.onEvent({
                        type: "log:append",
                        agentId: this.agentId,
                        taskId,
                        stream: "stderr",
                        chunk: `💭 ${snippet}…`,
                      });
                    }
                  }
                  if (block.type === "tool_use" && block.name) {
                    const toolName = block.name as string;
                    const toolInput = block.input as Record<string, unknown> | undefined;
                    // Track files actually modified by Write/Edit tools
                    if ((toolName === "Write" || toolName === "Edit") && toolInput?.file_path) {
                      this.taskChangedFiles.add(toolInput.file_path as string);
                    }
                    const activity = summarizeToolUse(toolName, toolInput);
                    if (activity) {
                      this.onEvent({
                        type: "log:activity",
                        agentId: this.agentId,
                        taskId,
                        text: activity,
                      });
                    }
                  }
                }
                // (conversationLog removed — recovery context now uses @bit-office/memory's
                //  structured SessionSummary instead of raw message fragments)
              } else if (msg.type === "result") {
                // Result message: authoritative session total from msg.usage
                if (msg.usage) {
                  const usage = msg.usage;
                  const totalIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
                  const totalOut = usage.output_tokens ?? 0;
                  // Replace live accumulation with authoritative total
                  this.taskInputTokens = totalIn;
                  this.taskOutputTokens = totalOut;
                  this.onEvent({
                    type: "token:update",
                    agentId: this.agentId,
                    inputTokens: this.taskInputTokens,
                    outputTokens: this.taskOutputTokens,
                  });
                }
                if (msg.result) {
                  if (!this.stdoutBuffer) {
                    this.stdoutBuffer = msg.result;
                    handleTextLine(msg.result);
                  }
                  this._lastResultText = msg.result;
                }
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
        const agentPid = this.process?.pid;
        this.process = null;
        if (this.taskTimeout) { clearTimeout(this.taskTimeout); this.taskTimeout = null; }

        // Kill the agent's process group to clean up any orphan child processes
        // (e.g., dev servers the agent may have started despite prompt instructions)
        if (agentPid) {
          try { process.kill(-agentPid, "SIGTERM"); } catch { /* group already dead */ }
        }

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
            this.resumeFailCount = 0; // Reset on success
            saveSessionId(this.agentId, this.sessionId);

            const { summary, fullOutput, changedFiles, entryFile, projectDir, previewCmd, previewPort } = this.extractResult();
            this._lastFullOutput = fullOutput;

            // Commit session to @bit-office/memory: extracts structured summary,
            // saves session history, and extracts reusable agent facts.
            // This replaces the old saveRecoveryContext + raw recentMessages approach.
            commitSession({
              agentId: this.agentId,
              agentName: this.name,
              stdout: this.stdoutBuffer,
              summary: summary ?? undefined,
              changedFiles: [...this.taskChangedFiles],
              tokens: { input: this.taskInputTokens, output: this.taskOutputTokens },
            });

            // Preview detection: skip for team leads (they don't create files).
            // Leader preview is handled by the orchestrator when isFinalResult is set.
            // Also skip when no work was done (no changed files and no structured preview fields)
            // to prevent false-positive previews on casual conversations like "hi".
            const stdoutMentionsFile = /\.html?\b/i.test(this.stdoutBuffer);
            const hasWorkOutput = changedFiles.length > 0 || entryFile || previewCmd || projectDir || stdoutMentionsFile;
            const { previewUrl, previewPath } = (this._isTeamLead || !hasWorkOutput)
              ? { previewUrl: undefined, previewPath: undefined }
              : this.detectPreview();

            this._lastResult = `done: ${summary.slice(0, 120)}`;
            this.setStatus("done");
            const tokenUsage = (this.taskInputTokens > 0 || this.taskOutputTokens > 0)
              ? { inputTokens: this.taskInputTokens, outputTokens: this.taskOutputTokens }
              : undefined;
            this.onEvent({
              type: "task:done",
              agentId: this.agentId,
              taskId: completedTaskId,
              result: { summary, fullOutput, changedFiles, diffStat: "", testResult: "unknown", previewUrl, previewPath, entryFile, projectDir, previewCmd, previewPort, tokenUsage },
            });
            this.onTaskComplete?.(this.agentId, completedTaskId, summary, true, fullOutput);
            this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, CONFIG.timing.idleDoneDelayMs);
          } else {
            // If resume produced 0 output, the session MAY be corrupted — but don't
            // clear immediately. Transient errors (API rate limit, balance exhaustion,
            // network timeout) also produce 0 output. Clearing the session on the first
            // failure causes total context loss when the user retries.
            // Strategy: only clear after 2+ consecutive 0-output failures.
            if (this.sessionId && this.stdoutBuffer.length === 0) {
              this.resumeFailCount++;
              if (this.resumeFailCount >= 2) {
                console.log(`[Agent ${this.agentId}] Resume session ${this.sessionId} failed ${this.resumeFailCount}x consecutively (0ch output), clearing corrupted session`);
                this.sessionId = null;
                this.hasHistory = false;
                this.resumeFailCount = 0;
                saveSessionId(this.agentId, null);
              } else {
                console.log(`[Agent ${this.agentId}] Resume session ${this.sessionId} failed (0ch output), attempt ${this.resumeFailCount}/2 — preserving session for retry`);
              }
            } else if (this.stdoutBuffer.length > 0) {
              // Non-zero output on a failed run proves the session is alive —
              // reset the counter so only truly consecutive 0-output failures
              // trigger session reset.
              this.resumeFailCount = 0;

              // Commit session on error exit too — any conversation with output
              // is worth preserving for recovery context on next restart.
              try {
                commitSession({
                  agentId: this.agentId,
                  agentName: this.name,
                  stdout: this.stdoutBuffer,
                  summary: undefined,
                  changedFiles: [...this.taskChangedFiles],
                  tokens: { input: this.taskInputTokens, output: this.taskOutputTokens },
                });
              } catch { /* best effort */ }
            }
            // Extract meaningful error lines from stderr (e.g. "ERROR: You've hit your usage limit...")
            const stderrErrorLines = this.stderrBuffer
              .split("\n")
              .filter((l) => /^\s*(ERROR|error|Error)[:\s]/i.test(l))
              .map((l) => l.trim());
            const stderrError = stderrErrorLines[stderrErrorLines.length - 1] ?? "";
            const errorMsg = stderrError || this.stdoutBuffer.slice(0, 300) || this.stderrBuffer.slice(-300) || `Process exited with code ${code}`;
            this._lastResult = `failed: ${errorMsg.slice(0, 120)}`;
            this.setStatus("error");
            this.onEvent({
              type: "task:failed",
              agentId: this.agentId,
              taskId: completedTaskId,
              error: errorMsg,
            });
            this.onTaskComplete?.(this.agentId, completedTaskId, errorMsg, false);
            // Auto-cleanup orphaned worktree + branch on failure (prevents leftover branches)
            if (this.worktreePath && this.worktreeBranch) {
              try {
                removeWorktree(this.worktreePath, this.worktreeBranch);
                console.log(`[Agent ${this.name}] Cleaned up worktree branch on failure: ${this.worktreeBranch}`);
              } catch (e) { console.error(`[Agent ${this.name}] Worktree cleanup failed:`, e); }
              this.worktreePath = null;
              this.worktreeBranch = null;
            }
            this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, CONFIG.timing.idleErrorDelayMs);
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
        const errorMsg = (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `"${this.backend.command}" not found. Please install it and make sure it's in your PATH.`
          : err.message;
        this.onEvent({
          type: "task:failed",
          agentId: this.agentId,
          taskId,
          error: errorMsg,
        });
        this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, CONFIG.timing.idleErrorDelayMs);
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
    const result = this.extractResult();
    const baseCwd = this.currentCwd ?? this.workspace;
    const cwd = result.projectDir
      ? (path.isAbsolute(result.projectDir) ? result.projectDir : path.join(baseCwd, result.projectDir))
      : baseCwd;

    return resolvePreview({
      entryFile: result.entryFile,
      previewCmd: result.previewCmd,
      previewPort: result.previewPort,
      changedFiles: result.changedFiles,
      stdout: this.stdoutBuffer,
      cwd,
      workspace: baseCwd,
    });
  }

  /**
   * Parse stdoutBuffer for structured result (SUMMARY/STATUS/FILES_CHANGED).
   * Falls back to a cleaned-up excerpt of the raw output.
   */
  private extractResult() {
    const result = parseAgentOutput(this.stdoutBuffer, this._lastResultText);
    // Merge files tracked from actual tool_use events (Write/Edit) into changedFiles.
    // This ensures changedFiles is populated even when the agent doesn't output FILES_CHANGED.
    if (this.taskChangedFiles.size > 0) {
      const existing = new Set(result.changedFiles);
      for (const f of this.taskChangedFiles) {
        if (!existing.has(f)) result.changedFiles.push(f);
      }
    }
    return result;
  }

  private dequeueNext() {
    if (this.taskQueue.length === 0) return;
    const next = this.taskQueue.shift()!;
    setTimeout(() => {
      this.runTask(next.taskId, next.prompt, next.repoPath, next.teamContext, false, next.phaseOverride);
    }, CONFIG.timing.dequeueDelayMs);
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
    this.idleTimer = setTimeout(() => { this.idleTimer = null; this.setStatus("idle"); }, CONFIG.timing.idleErrorDelayMs);
  }

  destroy() {
    if (this.taskTimeout) { clearTimeout(this.taskTimeout); this.taskTimeout = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }

    // Commit whatever we have before killing — this is the ONLY chance to
    // persist the current conversation when the app exits mid-task.
    // The AI backend's own session memory is lost on SIGKILL, so this
    // session summary is what the agent sees as recovery context on restart.
    if (this.stdoutBuffer.length > 0) {
      try {
        commitSession({
          agentId: this.agentId,
          agentName: this.name,
          stdout: this.stdoutBuffer,
          summary: undefined, // let extractSessionSummary derive from stdout
          changedFiles: [...this.taskChangedFiles],
          tokens: { input: this.taskInputTokens, output: this.taskOutputTokens },
        });
        console.log(`[Agent ${this.agentId}] Committed partial session on destroy (${this.stdoutBuffer.length}ch)`);
      } catch (e) {
        console.error(`[Agent ${this.agentId}] Failed to commit session on destroy:`, e);
      }
    }

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

  /** Reset conversation history so the next task starts fresh (used by End Project). */
  clearHistory() {
    this.hasHistory = false;
    this.sessionId = null;
    this.originalTask = null;
    this.currentPhase = null;
    this._hasExecuted = false;
    this._lastResult = null;
    this._lastResultText = null;
    this._lastFullOutput = null;
    this.setStatus("idle");
    // Full clear: remove both session ID and recovery context (project ended)
    const dir = path.dirname(getSessionFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const raw = loadRawMap();
    delete raw[this.agentId];
    writeFileSync(getSessionFile(), JSON.stringify(raw), "utf-8");
    // Also clear new memory store's session history for this agent
    // to prevent stale L1 summaries from leaking into the next project.
    saveSessionHistory(this.agentId, { latest: null, history: [] });
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
