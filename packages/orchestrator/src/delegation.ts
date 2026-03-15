import { nanoid } from "nanoid";
import path from "path";
import { CONFIG } from "./config.js";
import { createWorktree, mergeWorktree, removeWorktree, removeWorktreeOnly, checkConflicts } from "./worktree.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentSession } from "./agent-session.js";
import type { PromptEngine } from "./prompt-templates.js";
import type { OrchestratorEvent } from "./types.js";

interface PendingResult {
  fromName: string;
  statusWord: string;
  summary: string;
}

/** Per-task delegation metadata — consolidates what was 4 separate Maps/Sets */
interface TaskMeta {
  /** Agent that delegated this task */
  origin: string;
  /** How many hops from the original user task */
  depth: number;
  /** True if this task was created by flushResults (leader processing worker results) */
  isResultTask?: boolean;
  /** Snapshot of totalDelegations when this result task started */
  delegationsAtStart?: number;
  /** True if this is a direct fix task (reviewer → dev shortcut) — needs re-review on completion */
  isDirectFix?: boolean;
  /** The reviewer agentId that triggered the direct fix (for auto re-review) */
  reviewerAgentId?: string;
  /** Original review context (features to check) — carried through for re-review resilience */
  reviewContext?: string;
}

export class DelegationRouter {
  /** All per-task delegation metadata, keyed by taskId */
  private tasks = new Map<string, TaskMeta>();
  /** agentId → taskId of the delegated task currently assigned TO this agent */
  private assignedTask = new Map<string, string>();
  /** Total delegations in current team session (reset on clearAll) */
  private totalDelegations = 0;
  /** How many times the leader has been invoked to process results */
  private leaderRounds = 0;
  /** How many times a Code Reviewer result has been forwarded to the leader */
  private reviewCount = 0;
  /** When true, all new delegations and result forwarding are blocked */
  private stopped = false;
  /** Batch result forwarding: originAgentId → pending results + timer */
  private pendingResults = new Map<string, { results: PendingResult[]; timer: ReturnType<typeof setTimeout> }>();
  /** Team-wide project directory — all delegations use this as repoPath when set */
  private teamProjectDir: string | null = null;
  /** Direct fix attempts per dev agent (reviewer → dev shortcut without leader) */
  private devFixAttempts = new Map<string, number>();
  /** Tracks which dev agent was last assigned to work (for reviewer → dev routing) */
  private lastDevAgentId: string | null = null;
  /** Last known preview fields from developer output (survives across rounds for leader context) */
  private lastDevPreview: string = "";
  private agentManager: AgentManager;
  private promptEngine: PromptEngine;
  private emitEvent: (event: OrchestratorEvent) => void;
  private worktreeEnabled: boolean;
  private worktreeMerge: boolean;

  constructor(
    agentManager: AgentManager,
    promptEngine: PromptEngine,
    emitEvent: (event: OrchestratorEvent) => void,
    worktreeEnabled = false,
    worktreeMerge = true,
  ) {
    this.agentManager = agentManager;
    this.promptEngine = promptEngine;
    this.emitEvent = emitEvent;
    this.worktreeEnabled = worktreeEnabled;
    this.worktreeMerge = worktreeMerge;
  }

  /**
   * Wire delegation and result forwarding callbacks onto a session.
   */
  wireAgent(session: AgentSession): void {
    this.wireDelegation(session);
    this.wireResultForwarding(session);
  }

  /**
   * Check if a taskId was delegated (has an origin).
   */
  isDelegated(taskId: string): boolean {
    const meta = this.tasks.get(taskId);
    return !!meta && !meta.isResultTask;
  }

  /**
   * True if this taskId was created by flushResults (leader processing worker results).
   * Only result-processing tasks are eligible to be marked as isFinalResult.
   */
  isResultTask(taskId: string): boolean {
    return this.tasks.get(taskId)?.isResultTask === true;
  }

  /**
   * True when the delegation budget is exhausted — leader should finalize even
   * if the current task is not a "resultTask" (safety net for convergence).
   */
  isBudgetExhausted(): boolean {
    return this.leaderRounds >= CONFIG.delegation.budgetRounds || this.reviewCount >= CONFIG.delegation.maxReviewRounds;
  }

  /**
   * True if the given resultTask completed WITHOUT creating any new delegations.
   * This means the leader decided to summarize/finish rather than delegate more work.
   */
  resultTaskDidNotDelegate(taskId: string): boolean {
    const meta = this.tasks.get(taskId);
    if (!meta?.isResultTask || meta.delegationsAtStart === undefined) return false;
    return this.totalDelegations === meta.delegationsAtStart;
  }

  /**
   * Check if there are any pending delegated tasks originating from a given agent.
   */
  hasPendingFrom(agentId: string): boolean {
    for (const meta of this.tasks.values()) {
      if (meta.origin === agentId && !meta.isResultTask) return true;
    }
    return false;
  }

  /**
   * Remove all delegation tracking for a specific agent (on fire/cancel).
   */
  clearAgent(agentId: string): void {
    for (const [taskId, meta] of this.tasks) {
      if (meta.origin === agentId) {
        this.tasks.delete(taskId);
      }
    }
    this.assignedTask.delete(agentId);
    const pending = this.pendingResults.get(agentId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResults.delete(agentId);
    }
  }

  /**
   * Block all future delegations and result forwarding. Call before cancelling tasks.
   */
  stop(): void {
    this.stopped = true;
    for (const pending of this.pendingResults.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingResults.clear();
  }

  /**
   * Set a team-wide project directory. All delegations will use this as repoPath.
   */
  setTeamProjectDir(dir: string | null): void {
    this.teamProjectDir = dir;
    if (dir) console.log(`[Delegation] Team project dir set: ${dir}`);
  }

  getTeamProjectDir(): string | null {
    return this.teamProjectDir;
  }

  /**
   * Reset all delegation state (on new team task).
   */
  clearAll(): void {
    this.tasks.clear();
    this.assignedTask.clear();
    this.totalDelegations = 0;
    this.leaderRounds = 0;
    this.reviewCount = 0;
    this.stopped = false;
    this.teamProjectDir = null;
    this.devFixAttempts.clear();
    this.lastDevAgentId = null;
    this.lastDevPreview = "";
    for (const pending of this.pendingResults.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingResults.clear();
  }

  private wireDelegation(session: AgentSession): void {
    session.onDelegation = (fromAgentId, targetName, prompt) => {
      if (this.stopped) return;

      // Block delegation in conversational phases (create, design, complete)
      const phaseCheckSession = this.agentManager.get(fromAgentId);
      if (phaseCheckSession?.currentPhase && phaseCheckSession.currentPhase !== "execute") {
        console.log(`[Delegation] BLOCKED: agent ${fromAgentId} is in phase "${phaseCheckSession.currentPhase}", not "execute"`);
        return;
      }

      if (this.isBudgetExhausted()) {
        console.log(`[Delegation] BLOCKED: budget exhausted (leaderRounds=${this.leaderRounds}/${CONFIG.delegation.budgetRounds}, reviewCount=${this.reviewCount}/${CONFIG.delegation.maxReviewRounds})`);
        return;
      }

      const target = this.agentManager.findByName(targetName);
      if (!target) {
        console.log(`[Delegation] Target agent "${targetName}" not found, ignoring`);
        return;
      }

      if (this.totalDelegations >= CONFIG.delegation.maxTotal) {
        console.log(`[Delegation] BLOCKED: total delegation limit (${CONFIG.delegation.maxTotal}) reached`);
        this.emitEvent({
          type: "team:chat",
          fromAgentId,
          message: `Delegation blocked: total limit of ${CONFIG.delegation.maxTotal} delegations reached. Summarize current results for the user.`,
          messageType: "status",
          timestamp: Date.now(),
        });
        return;
      }

      const myTaskId = this.assignedTask.get(fromAgentId);
      const parentDepth = myTaskId ? (this.tasks.get(myTaskId)?.depth ?? 0) : 0;
      const newDepth = parentDepth + 1;

      if (newDepth > CONFIG.delegation.maxDepth) {
        console.log(`[Delegation] BLOCKED: depth ${newDepth} exceeds max ${CONFIG.delegation.maxDepth}`);
        this.emitEvent({
          type: "team:chat",
          fromAgentId,
          message: `Delegation blocked: chain depth (${newDepth}) exceeds limit. Complete current work directly.`,
          messageType: "status",
          timestamp: Date.now(),
        });
        return;
      }

      const taskId = nanoid();
      this.tasks.set(taskId, { origin: fromAgentId, depth: newDepth });
      this.totalDelegations++;
      const fromSession = this.agentManager.get(fromAgentId);
      const fromName = fromSession?.name ?? fromAgentId;
      const fromRole = fromSession?.role ?? "Team Lead";

      // Use team project dir if set (created by gateway on APPROVE_PLAN);
      // otherwise fall back to parsing [project-dir] from the delegation prompt.
      let repoPath: string | undefined = this.teamProjectDir ?? undefined;
      let cleanPrompt = prompt;
      const dirMatch = prompt.match(/^\s*\[([^\]]+)\]\s*/);
      if (dirMatch) {
        // Strip [project-dir] prefix from prompt even if we don't use it for repoPath
        cleanPrompt = prompt.slice(dirMatch[0].length);
        if (!repoPath) {
          const dirPart = dirMatch[1].replace(/\/$/, "");
          const leaderSession = this.agentManager.get(fromAgentId);
          if (leaderSession) {
            repoPath = path.resolve(leaderSession.workspaceDir, dirPart);
          }
        }
      }

      const fullPrompt = this.promptEngine.render("delegation-prefix", { fromName, fromRole, prompt: cleanPrompt });

      // Track last dev worker for reviewer → dev shortcut routing
      const targetRole = target.role.toLowerCase();
      if (!targetRole.includes("review") && !targetRole.includes("lead")) {
        this.lastDevAgentId = target.agentId;
      }

      // Create worktree for dev agents in team mode
      let effectiveRepoPath = repoPath;
      if (this.worktreeEnabled && repoPath && !target.worktreePath) {
        const targetRole = target.role.toLowerCase();
        const isDevWorker = !targetRole.includes("review") && !targetRole.includes("lead");
        if (isDevWorker) {
          const wt = createWorktree(repoPath, target.agentId, taskId, target.name);
          if (wt) {
            const branch = `agent/${target.name.toLowerCase().replace(/\s+/g, "-")}/${taskId}`;
            target.worktreePath = wt;
            target.worktreeBranch = branch;
            effectiveRepoPath = wt;
            this.emitEvent({
              type: "worktree:created",
              agentId: target.agentId,
              taskId,
              worktreePath: wt,
              branch,
            });
          }
        }
      }

      console.log(`[Delegation] ${fromAgentId} -> ${target.agentId} (${targetName}) depth=${newDepth} total=${this.totalDelegations} repoPath=${effectiveRepoPath ?? "default"}: ${cleanPrompt.slice(0, 80)}`);
      this.emitEvent({
        type: "task:delegated",
        fromAgentId,
        toAgentId: target.agentId,
        taskId,
        prompt: cleanPrompt,
      });
      this.emitEvent({
        type: "team:chat",
        fromAgentId,
        toAgentId: target.agentId,
        message: prompt,
        messageType: "delegation",
        taskId,
        timestamp: Date.now(),
      });
      this.assignedTask.set(target.agentId, taskId);
      // Broadcast activity for awareness
      this.emitEvent({
        type: "agent:activity",
        agentId: target.agentId,
        agentName: target.name,
        intent: cleanPrompt.slice(0, 200),
        phase: "started",
      });
      target.runTask(taskId, fullPrompt, effectiveRepoPath);
    };
  }

  private wireResultForwarding(session: AgentSession): void {
    session.onTaskComplete = (agentId, taskId, summary, success, fullOutput) => {
      if (this.stopped) return;

      const meta = this.tasks.get(taskId);
      if (!meta || meta.isResultTask) return; // Result tasks are not forwarded — they're leader-internal
      const originAgentId = meta.origin;
      this.tasks.delete(taskId);
      if (this.assignedTask.get(agentId) === taskId) {
        this.assignedTask.delete(agentId);
      }

      const originSession = this.agentManager.get(originAgentId);
      if (!originSession) return;

      const fromSession = this.agentManager.get(agentId);
      const fromName = fromSession?.name ?? agentId;
      const statusWord = success ? "completed successfully" : "failed";

      console.log(`[ResultForward] ${agentId} -> ${originAgentId}: ${summary.slice(0, 80)} (success=${success})`);

      this.emitEvent({
        type: "task:result-returned",
        fromAgentId: agentId,
        toAgentId: originAgentId,
        taskId,
        summary,
        success,
      });

      this.emitEvent({
        type: "team:chat",
        fromAgentId: agentId,
        toAgentId: originAgentId,
        message: summary.slice(0, 400),
        messageType: "result",
        taskId,
        timestamp: Date.now(),
      });

      // Broadcast activity completion
      this.emitEvent({
        type: "agent:activity",
        agentId,
        agentName: fromName,
        intent: summary.slice(0, 200),
        phase: "completed",
      });

      // ── Worktree merge on task completion (non-blocking) ──
      if (fromSession?.worktreePath && fromSession.worktreeBranch && this.teamProjectDir) {
        try {
          if (this.worktreeMerge && success) {
            const conflicts = checkConflicts(this.teamProjectDir, fromSession.worktreeBranch);
            if (conflicts.length > 0) {
              console.log(`[Worktree] Conflict detected for ${fromName}: ${conflicts.join(", ")}`);
              removeWorktreeOnly(fromSession.worktreePath, this.teamProjectDir);
              this.emitEvent({ type: "worktree:merged", agentId, taskId, branch: fromSession.worktreeBranch, success: false, conflictFiles: conflicts });
            } else {
              const result = mergeWorktree(this.teamProjectDir, fromSession.worktreePath, fromSession.worktreeBranch);
              this.emitEvent({ type: "worktree:merged", agentId, taskId, branch: fromSession.worktreeBranch, success: result.success, conflictFiles: result.conflictFiles });
            }
          } else {
            removeWorktree(fromSession.worktreePath, fromSession.worktreeBranch, this.teamProjectDir);
          }
        } catch (err) {
          console.error(`[Worktree] Merge failed for ${fromName}, continuing result forwarding:`, err);
        }
        fromSession.worktreePath = null;
        fromSession.worktreeBranch = null;
      }

      // ── Direct fix complete: dev finished fix → auto re-review ──
      if (meta.isDirectFix && meta.reviewerAgentId && success) {
        const reviewerSession = this.agentManager.get(meta.reviewerAgentId);
        if (reviewerSession) {
          const reReviewTaskId = nanoid();
          this.tasks.set(reReviewTaskId, { origin: originAgentId, depth: 1 });
          this.assignedTask.set(meta.reviewerAgentId, reReviewTaskId);
          this.totalDelegations++;

          // Include the original review context (reviewer's FAIL output) so the re-review
          // has full context even if --resume fails and session history is lost.
          const originalContext = meta.reviewContext
            ? `\n\nYour previous review (for reference):\n${meta.reviewContext}`
            : "";
          const reReviewPrompt = this.promptEngine.render("worker-continue", {
            prompt: `[Re-review after fix] ${fromName} has fixed the issues you reported. Please review the code again.\n\nDev's fix report:\n${summary.slice(0, 600)}${originalContext}\n\n===== YOUR TASK =====\n1. Check if ALL previously reported ISSUES are resolved\n2. Verify the deliverable runs without crashes\n3. Verify core features work (compare against the original task requirements)\n\nVERDICT: PASS | FAIL\n- PASS = code runs without crashes AND core features are implemented (even if rough)\n- FAIL = crashes/bugs that prevent usage OR core features are missing/broken\nISSUES: (numbered list if FAIL — only real bugs or missing core features)\nSUMMARY: (one sentence overall assessment)`,
          });
          const repoPath = this.teamProjectDir ?? undefined;

          console.log(`[DirectFix] Dev ${fromName} fix complete → auto re-review by ${reviewerSession.name}`);
          this.emitEvent({
            type: "task:delegated",
            fromAgentId: agentId,
            toAgentId: meta.reviewerAgentId,
            taskId: reReviewTaskId,
            prompt: `Re-review after fix by ${fromName}`,
          });
          this.emitEvent({
            type: "team:chat",
            fromAgentId: agentId,
            toAgentId: meta.reviewerAgentId,
            message: `Fix completed, requesting re-review`,
            messageType: "result",
            taskId: reReviewTaskId,
            timestamp: Date.now(),
          });

          reviewerSession.runTask(reReviewTaskId, reReviewPrompt, repoPath);
          return; // Handled — skip normal leader forwarding
        }
      }

      // ── Direct fix shortcut: reviewer FAIL → dev (skip leader) ──
      if (this.tryDirectFix(agentId, fromSession, fullOutput ?? summary, originAgentId)) {
        return; // Handled — skip normal leader forwarding
      }

      // Capture preview fields from developer results so leader always has them
      const fromRole = fromSession?.role?.toLowerCase() ?? "";
      if (!fromRole.includes("review") && fullOutput) {
        const lines: string[] = [];
        const em = fullOutput.match(/ENTRY_FILE:\s*(.+)/i);
        const cm = fullOutput.match(/PREVIEW_CMD:\s*(.+)/i);
        const pm = fullOutput.match(/PREVIEW_PORT:\s*[*`_]*(\d+)/i);
        if (em) lines.push(`ENTRY_FILE: ${em[1].trim()}`);
        if (cm) lines.push(`PREVIEW_CMD: ${cm[1].trim()}`);
        if (pm) lines.push(`PREVIEW_PORT: ${pm[1]}`);
        if (lines.length > 0) this.lastDevPreview = lines.join("\n");
      }

      // Batch results: accumulate and flush to leader after a short window
      this.enqueueResult(originAgentId, { fromName, statusWord, summary: summary.slice(0, 400) });
    };
  }

  /**
   * Attempt a direct reviewer → dev fix shortcut.
   * Returns true if the shortcut was taken (caller should skip normal forwarding).
   *
   * Strategy:
   * - First FAIL: route directly to dev with reviewer feedback (skip leader)
   * - Second FAIL for same dev: escalate to leader (maybe needs a different approach)
   */
  private tryDirectFix(
    reviewerAgentId: string,
    reviewerSession: AgentSession | undefined,
    output: string,
    originAgentId: string,
  ): boolean {
    // Only applies to reviewers
    const role = reviewerSession?.role?.toLowerCase() ?? "";
    if (!role.includes("review")) return false;

    // Parse verdict from reviewer output (fullOutput contains VERDICT line)
    const verdictMatch = output.match(/VERDICT[:\s]*(\w+)/i);
    if (!verdictMatch || verdictMatch[1].toUpperCase() !== "FAIL") return false;

    // Find the dev to send the fix to
    const devAgentId = this.lastDevAgentId;
    if (!devAgentId) return false;

    const devSession = this.agentManager.get(devAgentId);
    if (!devSession) return false;

    // Check fix attempt count for this dev
    const attempts = this.devFixAttempts.get(devAgentId) ?? 0;
    if (attempts >= CONFIG.delegation.maxDirectFixes) {
      console.log(`[DirectFix] Dev ${devSession.name} already had ${attempts} direct fix(es), escalating to leader`);
      return false; // Fall through to normal leader forwarding
    }

    // Check global review budget BEFORE committing (don't increment yet — flushResults does its own counting if we bail)
    if (this.reviewCount >= CONFIG.delegation.maxReviewRounds) {
      console.log(`[DirectFix] Review limit reached (${this.reviewCount}/${CONFIG.delegation.maxReviewRounds}), escalating to leader`);
      return false;
    }

    // Commit: we are taking the shortcut
    this.reviewCount++;
    this.devFixAttempts.set(devAgentId, attempts + 1);
    this.totalDelegations++;

    // Build a fix prompt from reviewer feedback.
    // Carry the reviewer's full FAIL output as reviewContext — it contains the issues list
    // AND implicitly the features that were checked. If --resume fails on re-review,
    // this context ensures the reviewer still knows what to verify.
    const fixTaskId = nanoid();
    this.tasks.set(fixTaskId, {
      origin: originAgentId,
      depth: 1,
      isDirectFix: true,
      reviewerAgentId: reviewerAgentId,
      reviewContext: output.slice(0, 1000),
    });
    this.assignedTask.set(devAgentId, fixTaskId);

    const reviewerName = reviewerSession?.name ?? "Code Reviewer";
    const fixPrompt = this.promptEngine.render("worker-direct-fix", {
      reviewerName,
      reviewFeedback: output.slice(0, 800),
    });

    const repoPath = this.teamProjectDir ?? undefined;

    console.log(`[DirectFix] ${reviewerName} FAIL → ${devSession.name} (attempt ${attempts + 1}/${CONFIG.delegation.maxDirectFixes}, skipping leader)`);
    this.emitEvent({
      type: "task:delegated",
      fromAgentId: reviewerAgentId,
      toAgentId: devAgentId,
      taskId: fixTaskId,
      prompt: `Fix issues from ${reviewerName}'s review`,
    });
    this.emitEvent({
      type: "team:chat",
      fromAgentId: reviewerAgentId,
      toAgentId: devAgentId,
      message: `Direct fix: ${output.slice(0, 300)}`,
      messageType: "delegation",
      taskId: fixTaskId,
      timestamp: Date.now(),
    });

    devSession.runTask(fixTaskId, fixPrompt, repoPath);
    return true;
  }

  /**
   * Queue a result for batched forwarding to the origin agent.
   * Flush only when ALL delegated tasks from this origin have returned.
   * The timer is a safety net — if a worker somehow disappears without returning,
   * we don't want the leader to wait forever.
   */
  private enqueueResult(originAgentId: string, result: PendingResult): void {
    let pending = this.pendingResults.get(originAgentId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.results.push(result);
    } else {
      pending = { results: [result], timer: null as unknown as ReturnType<typeof setTimeout> };
      this.pendingResults.set(originAgentId, pending);
    }

    // Flush when ALL delegated tasks have returned — no more guessing with timers
    if (!this.hasPendingFrom(originAgentId)) {
      console.log(`[ResultBatch] All delegated tasks returned for ${originAgentId}, flushing ${pending.results.length} result(s)`);
      this.flushResults(originAgentId);
      return;
    }

    // Safety net: if a worker is still running after the timeout, flush what we have
    // so the leader isn't blocked forever by a hung worker
    console.log(`[ResultBatch] ${originAgentId} still has pending delegations, waiting (safety timeout: ${CONFIG.timing.resultBatchWindowMs / 1000}s)`);
    pending.timer = setTimeout(() => {
      console.log(`[ResultBatch] Safety timeout reached for ${originAgentId}, flushing ${pending.results.length} partial result(s)`);
      this.flushResults(originAgentId);
    }, CONFIG.timing.resultBatchWindowMs);
  }

  /** Flush all pending results for an origin agent as a single leader prompt. */
  private flushResults(originAgentId: string): void {
    if (this.stopped) return;

    const pending = this.pendingResults.get(originAgentId);
    if (!pending || pending.results.length === 0) return;
    this.pendingResults.delete(originAgentId);
    clearTimeout(pending.timer);

    const originSession = this.agentManager.get(originAgentId);
    if (!originSession) return;

    this.leaderRounds++;

    // Count reviewer results for precise iteration tracking
    for (const r of pending.results) {
      const agent = this.agentManager.findByName(r.fromName);
      if (agent && agent.role.toLowerCase().includes("review")) {
        this.reviewCount++;
        console.log(`[ResultBatch] Reviewer result detected (reviewCount=${this.reviewCount})`);
      }
    }

    // Hard ceiling: force-complete instead of silently returning
    if (this.leaderRounds > CONFIG.delegation.hardCeilingRounds) {
      console.log(`[ResultBatch] Hard ceiling reached (${CONFIG.delegation.hardCeilingRounds} rounds). Force-completing.`);

      const resultLines = pending.results.map(r =>
        `- ${r.fromName} (${r.statusWord}): ${r.summary}`
      ).join("\n");

      this.emitEvent({
        type: "team:chat",
        fromAgentId: originAgentId,
        message: `Team work auto-completed after ${CONFIG.delegation.hardCeilingRounds} rounds.`,
        messageType: "status",
        timestamp: Date.now(),
      });

      // Emit a synthetic task:done so the UI gets a proper final result
      this.emitEvent({
        type: "task:done",
        agentId: originAgentId,
        taskId: `auto-complete-${Date.now()}`,
        result: {
          summary: `Auto-completed after ${CONFIG.delegation.hardCeilingRounds} rounds.\n${resultLines}`,
          changedFiles: [],
          diffStat: "",
          testResult: "unknown" as const,
        },
        isFinalResult: true,
      });
      return;
    }

    // Build round guidance for the leader prompt
    let roundInfo: string;
    const budgetExhausted = this.leaderRounds >= CONFIG.delegation.budgetRounds;
    const reviewExhausted = this.reviewCount >= CONFIG.delegation.maxReviewRounds;
    if (budgetExhausted || reviewExhausted) {
      roundInfo = reviewExhausted
        ? `REVIEW LIMIT REACHED (${this.reviewCount}/${CONFIG.delegation.maxReviewRounds} reviews). No more fix iterations. Output your FINAL SUMMARY now — accept the work as-is.`
        : `BUDGET REACHED (round ${this.leaderRounds}/${CONFIG.delegation.budgetRounds}). No more delegations allowed. Output your FINAL SUMMARY now.`;
    } else if (this.reviewCount > 0) {
      roundInfo = `Round ${this.leaderRounds}/${CONFIG.delegation.budgetRounds} | Review ${this.reviewCount}/${CONFIG.delegation.maxReviewRounds} (fix iteration ${this.reviewCount})`;
    } else {
      roundInfo = `Round ${this.leaderRounds}/${CONFIG.delegation.budgetRounds} | No reviews yet`;
    }

    const resultLines = pending.results.map(r =>
      `- ${r.fromName} (${r.statusWord}): ${r.summary}`
    ).join("\n\n");

    const followUpTaskId = nanoid();
    this.tasks.set(followUpTaskId, {
      origin: originAgentId,
      depth: 0,
      isResultTask: true,
      delegationsAtStart: this.totalDelegations,
    });
    const teamContext = this.agentManager.isTeamLead(originAgentId)
      ? this.agentManager.getTeamRoster()
      : undefined;

    const batchPrompt = this.promptEngine.render("leader-result", {
      fromName: pending.results.length === 1
        ? pending.results[0].fromName
        : `${pending.results.length} team members`,
      resultStatus: pending.results.every(r => r.statusWord.includes("success"))
        ? "completed successfully"
        : "mixed results",
      resultSummary: resultLines,
      originalTask: originSession.originalTask ?? "",
      roundInfo,
      devPreview: this.lastDevPreview,
    });

    console.log(`[ResultBatch] Flushing ${pending.results.length} result(s) to ${originAgentId} (round ${this.leaderRounds}, budget=${CONFIG.delegation.budgetRounds}, ceiling=${CONFIG.delegation.hardCeilingRounds})`);
    originSession.runTask(followUpTaskId, batchPrompt, undefined, teamContext);
  }
}
