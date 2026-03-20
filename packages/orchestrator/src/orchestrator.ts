import { EventEmitter } from "events";
import { existsSync } from "fs";
import { nanoid } from "nanoid";
import { CONFIG } from "./config.js";
import { AgentSession, clearSessionId } from "./agent-session.js";
import { AgentManager } from "./agent-manager.js";
import { DelegationRouter } from "./delegation.js";
import { PromptEngine } from "./prompt-templates.js";
import { RetryTracker } from "./retry.js";
import { PhaseMachine } from "./phase-machine.js";
import { finalizeTeamResult } from "./result-finalizer.js";
import { recordReviewFeedback, recordProjectCompletion, recordTechPreference, getMemoryContext } from "./memory.js";
import { createWorktree, mergeWorktree, removeWorktree } from "./worktree.js";
import type { AIBackend } from "./ai-backend.js";
import type { TeamPreview } from "./result-finalizer.js";
import type {
  OrchestratorOptions,
  CreateAgentOpts,
  CreateTeamOpts,
  RunTaskOpts,
  OrchestratorEvent,
  OrchestratorEventMap,
  TeamPhase,
  Decision,
} from "./types.js";

export class Orchestrator extends EventEmitter<OrchestratorEventMap> {
  private agentManager = new AgentManager();
  private delegationRouter: DelegationRouter;
  private promptEngine: PromptEngine;
  private retryTracker: RetryTracker | null;
  private phaseMachine = new PhaseMachine();
  private backends = new Map<string, AIBackend>();
  private defaultBackendId: string;
  private workspace: string;
  private sandboxMode: "full" | "safe";
  private worktreeEnabled: boolean;
  private worktreeMerge: boolean;
  /** Preview info captured from the first dev worker that produces one — not from QA/reviewer */
  private teamPreview: TeamPreview | null = null;
  /** Accumulated changedFiles from all workers in the current team session */
  private teamChangedFiles = new Set<string>();
  /** Guard against emitting isFinalResult more than once per execute cycle. */
  private teamFinalized = false;

  constructor(opts: OrchestratorOptions) {
    super();
    this.workspace = opts.workspace;
    this.sandboxMode = opts.sandboxMode ?? "full";

    // Worktree isolation
    if (opts.worktree === false) {
      this.worktreeEnabled = false;
      this.worktreeMerge = false;
    } else {
      this.worktreeEnabled = true;
      this.worktreeMerge = opts.worktree?.mergeOnComplete ?? true;
    }

    // Register backends
    for (const b of opts.backends) {
      this.backends.set(b.id, b);
    }
    this.defaultBackendId = opts.defaultBackend ?? opts.backends[0]?.id ?? "claude";

    // Prompt engine
    this.promptEngine = new PromptEngine(opts.promptsDir);
    this.promptEngine.init();

    // Delegation
    this.delegationRouter = new DelegationRouter(
      this.agentManager,
      this.promptEngine,
      (e) => this.emitEvent(e),
    );

    // Retry
    if (opts.retry === false) {
      this.retryTracker = null;
    } else {
      const r = opts.retry ?? {};
      this.retryTracker = new RetryTracker(r.maxRetries, r.escalateToLeader);
    }
  }

  // ---------------------------------------------------------------------------
  // Agent lifecycle
  // ---------------------------------------------------------------------------

  createAgent(opts: CreateAgentOpts): void {
    const backend = this.backends.get(opts.backend ?? this.defaultBackendId)
      ?? this.backends.get(this.defaultBackendId)!;

    // Inject memory context for dev workers and leaders (not reviewers)
    // Pass agentId so @bit-office/memory can include per-agent L2 facts + L3 shared knowledge
    const roleLower = opts.role.toLowerCase();
    const isReviewer = roleLower.includes("review");
    const memoryContext = !isReviewer ? getMemoryContext(opts.agentId) : "";

    const session = new AgentSession({
      agentId: opts.agentId,
      name: opts.name,
      role: opts.role,
      personality: opts.personality,
      workspace: opts.workDir ?? this.workspace,
      resumeHistory: opts.resumeHistory,
      backend,
      sandboxMode: this.sandboxMode,
      isTeamLead: this.agentManager.isTeamLead(opts.agentId),
      teamId: opts.teamId,
      memoryContext,
      onEvent: (e) => this.handleSessionEvent(e, opts.agentId),
      renderPrompt: (name, vars) => this.promptEngine.render(name, vars),
    });
    session.palette = opts.palette;

    this.agentManager.add(session);
    this.delegationRouter.wireAgent(session);

    this.emitEvent({
      type: "agent:created",
      agentId: opts.agentId,
      name: opts.name,
      role: opts.role,
      palette: opts.palette,
      personality: opts.personality,
      backend: backend.id,
      isTeamLead: this.agentManager.isTeamLead(opts.agentId),
      teamId: opts.teamId,
    });
    this.emitEvent({
      type: "agent:status",
      agentId: opts.agentId,
      status: "idle",
    });
  }

  removeAgent(agentId: string): void {
    const session = this.agentManager.get(agentId);
    // Force-clean worktree + branch on fire
    if (session?.worktreePath && session.worktreeBranch) {
      const base = session.worktreePath.includes(".worktrees")
        ? require("path").dirname(require("path").dirname(session.worktreePath))
        : this.workspace;
      removeWorktree(session.worktreePath, session.worktreeBranch, base);
      session.worktreePath = null;
      session.worktreeBranch = null;
    }
    this.cancelTask(agentId);
    this.delegationRouter.clearAgent(agentId);
    this.agentManager.delete(agentId);
    this.emitEvent({ type: "agent:fired", agentId });
  }

  setTeamLead(agentId: string): void {
    this.agentManager.setTeamLead(agentId);
    // Update the session's isTeamLead flag
    const session = this.agentManager.get(agentId);
    if (session) session.isTeamLead = true;
  }

  createTeam(opts: CreateTeamOpts): void {
    const presets = [
      { ...opts.memberPresets[opts.leadPresetIndex] ?? opts.memberPresets[0], isLead: true },
      ...opts.memberPresets.filter((_, i) => i !== opts.leadPresetIndex).map(p => ({ ...p, isLead: false })),
    ];

    let leadAgentId: string | null = null;

    for (const preset of presets) {
      const agentId = `agent-${nanoid(6)}`;
      const backendId = opts.backends?.[String(opts.memberPresets.indexOf(preset))] ?? this.defaultBackendId;

      this.createAgent({
        agentId,
        name: preset.name,
        role: preset.role,
        personality: preset.personality,
        palette: preset.palette,
        backend: backendId,
      });

      if ((preset as { isLead: boolean }).isLead) {
        leadAgentId = agentId;
        this.agentManager.setTeamLead(agentId);
      }
    }

    if (leadAgentId) {
      this.emitEvent({
        type: "team:chat",
        fromAgentId: leadAgentId,
        message: `Team created! ${presets.length} members ready.`,
        messageType: "status",
        timestamp: Date.now(),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Task execution
  // ---------------------------------------------------------------------------

  runTask(agentId: string, taskId: string, prompt: string, opts?: RunTaskOpts): void {
    const session = this.agentManager.get(agentId);
    if (!session) {
      this.emitEvent({
        type: "task:failed",
        agentId,
        taskId,
        error: "Agent not found. Create it first.",
      });
      return;
    }

    // User-initiated task on team lead: store original task + reset delegation counters
    if (this.agentManager.isTeamLead(agentId) && !this.delegationRouter.isDelegated(taskId)) {
      // Don't overwrite originalTask if it was pre-set (e.g. plan captured during create→design, or approved plan before execute)
      // In design/complete phases, originalTask holds the plan — user feedback is just the prompt, not a replacement.
      if (!session.originalTask || !opts?.phaseOverride || (opts.phaseOverride !== "execute" && opts.phaseOverride !== "design" && opts.phaseOverride !== "complete")) {
        session.originalTask = prompt;
      }
      // Preserve team project dir across execute cycles (set by gateway before runTask)
      const savedProjectDir = this.delegationRouter.getTeamProjectDir();
      this.delegationRouter.clearAll();
      if (savedProjectDir) this.delegationRouter.setTeamProjectDir(savedProjectDir);
      this.teamPreview = null;
      this.teamChangedFiles.clear();
      this.teamFinalized = false;
    }

    // Track for retry
    this.retryTracker?.track(taskId, prompt);

    const repoPath = opts?.repoPath;
    // Team lead gets full roster (to decide delegation).
    // Solo agents sharing a workspace get lightweight peer awareness.
    // Team workers get context via delegation.ts (buildWorkerTeamContext).
    let teamContext: string | undefined;
    if (this.agentManager.isTeamLead(agentId)) {
      teamContext = this.agentManager.getTeamRoster();
    } else if (!session.teamId) {
      teamContext = this.buildSoloPeerContext(agentId);
    }

    // Worktree isolation for solo agents sharing the same workspace.
    // Use stable metadata: count how many solo agents are *registered* for this
    // workspace (set at createAgent time), not how many happen to be running now.
    const isLeader = this.agentManager.isTeamLead(agentId);
    const isReviewerRole = session.role.toLowerCase().includes("review");
    const isSharedWorkspace = this.agentManager.getAll().filter(
      a => !a.teamId && a.workspaceDir === session.workspaceDir,
    ).length > 1;

    // NOTE: Claude Code's native --worktree flag is incompatible with -p and --resume
    // (causes exit code 1). All backends use managed worktrees (.worktrees/) instead.
    if (this.worktreeEnabled && !session.worktreePath && !isLeader && !isReviewerRole && isSharedWorkspace) {
      const base = repoPath ?? session.workspaceDir;
      const wt = createWorktree(base, agentId, taskId, session.name);
      if (wt) {
        const branch = `agent/${session.name.toLowerCase().replace(/\s+/g, "-")}/${taskId}`;
        session.worktreePath = wt;
        session.worktreeBranch = branch;
        // Clear history — can't --resume in a different directory
        session.clearHistory();
        this.emitEvent({ type: "worktree:created", agentId, taskId, worktreePath: wt, branch });
      }
    }

    session.runTask(taskId, prompt, repoPath, teamContext, true /* isUserInitiated */, opts?.phaseOverride);
  }

  /**
   * Restore worktree info on a live session (after gateway restart).
   */
  restoreWorktree(agentId: string, worktreePath: string, branch: string): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    // Validate worktree directory still exists on disk — stale paths from
    // previous runs cause spawn failures → 0-output → session clear cascade.
    if (!existsSync(worktreePath)) {
      console.warn(`[Orchestrator] Worktree ${worktreePath} no longer exists for agent ${agentId}, skipping restore`);
      return;
    }
    session.worktreePath = worktreePath;
    session.worktreeBranch = branch;
  }

  /**
   * Build lightweight peer context for solo agents sharing the same workspace.
   * Helps avoid file conflicts and provides awareness of concurrent work.
   * Returns empty string if no peers exist (~30 tokens per peer).
   */
  private buildSoloPeerContext(agentId: string): string | undefined {
    const session = this.agentManager.get(agentId);
    if (!session) return undefined;
    const lines: string[] = [];
    for (const other of this.agentManager.getAll()) {
      if (other.agentId === agentId) continue;
      if (other.teamId) continue; // skip team members — different workflow
      // Compare base workspace
      if (other.workspaceDir !== session.workspaceDir) continue;
      const status = other.status;
      const lastResult = other.lastResult;
      const brief = lastResult ? ` — ${lastResult.length > 80 ? lastResult.slice(0, 80) + "…" : lastResult}` : "";
      lines.push(`- ${other.name} (${other.role}) [${status}]${brief}`);
    }
    if (lines.length === 0) return undefined;
    return `===== WORKSPACE PEERS =====\nOther agents working in the same project (for awareness — coordinate to avoid file conflicts):\n${lines.join("\n")}`;
  }

  cancelTask(agentId: string): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    session.cancelTask();
  }

  /**
   * Stop all team agents — cancel their tasks but keep them alive.
   * Safe to call before fireTeam, or to just pause work.
   */
  stopTeam(): void {
    this.delegationRouter.stop();
    const teamAgents = this.agentManager.getAll().filter(a => !!a.teamId);
    for (const agent of teamAgents) {
      this.cancelTask(agent.agentId);
    }
    this.emitEvent({
      type: "team:chat",
      fromAgentId: teamAgents.find(a => this.agentManager.isTeamLead(a.agentId))?.agentId ?? "system",
      message: "Team work stopped. All tasks cancelled.",
      messageType: "status",
      timestamp: Date.now(),
    });
  }

  /**
   * Fire the entire team — stop all work silently, then remove all agents.
   */
  fireTeam(): void {
    this.delegationRouter.stop();
    const teamAgents = this.agentManager.getAll().filter(a => !!a.teamId);
    for (const agent of teamAgents) {
      this.removeAgent(agent.agentId);
    }
  }

  sendMessage(agentId: string, message: string): boolean {
    const session = this.agentManager.get(agentId);
    if (!session) return false;
    return session.sendMessage(message);
  }

  resolveApproval(approvalId: string, decision: Decision): void {
    for (const agent of this.agentManager.getAll()) {
      agent.resolveApproval(approvalId, decision);
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  getAgent(agentId: string) {
    const s = this.agentManager.get(agentId);
    if (!s) return undefined;
    return { agentId: s.agentId, name: s.name, role: s.role, status: s.status, palette: s.palette, backend: s.backend.id, pid: s.pid, teamId: s.teamId };
  }

  getAllAgents() {
    return this.agentManager.getAll().map(s => ({
      agentId: s.agentId, name: s.name, role: s.role, status: s.status,
      palette: s.palette, personality: s.personality, backend: s.backend.id, pid: s.pid,
      isTeamLead: this.agentManager.isTeamLead(s.agentId),
      teamId: s.teamId,
      worktreePath: s.worktreePath,
      worktreeBranch: s.worktreeBranch,
    }));
  }

  getTeamRoster(): string {
    return this.agentManager.getTeamRoster();
  }

  /** Return PIDs of all managed (gateway-spawned) agent processes */
  getManagedPids(): number[] {
    const pids: number[] = [];
    for (const session of this.agentManager.getAll()) {
      const pid = session.pid;
      if (pid !== null) pids.push(pid);
    }
    return pids;
  }

  isTeamLead(agentId: string): boolean {
    return this.agentManager.isTeamLead(agentId);
  }

  /** Get the leader's last full output (used to capture the approved plan). */
  getLeaderLastOutput(agentId: string): string | null {
    const session = this.agentManager.get(agentId);
    return session?.lastFullOutput ?? null;
  }

  /** Set team-wide project directory — all delegations will use this as cwd. */
  setTeamProjectDir(dir: string | null): void {
    this.delegationRouter.setTeamProjectDir(dir);
  }

  getTeamProjectDir(): string | null {
    return this.delegationRouter.getTeamProjectDir();
  }

  /** Get the original task context for the leader (the approved plan). */
  getOriginalTask(agentId: string): string | null {
    const session = this.agentManager.get(agentId);
    return session?.originalTask ?? null;
  }

  /** Set the original task context for the leader (e.g. the approved plan). */
  setOriginalTask(agentId: string, task: string): void {
    const session = this.agentManager.get(agentId);
    if (session) session.originalTask = task;
  }

  /** Mark leader as having already executed (for restart recovery — uses leader-continue instead of leader-initial). */
  setHasExecuted(agentId: string, value: boolean): void {
    const session = this.agentManager.get(agentId);
    if (session) session.hasExecuted = value;
  }

  /** Clear team members' conversation history for a fresh project cycle. */
  clearLeaderHistory(agentId: string): void {
    // Always clear the leader's session from disk, even if not in agentManager
    clearSessionId(agentId);

    const session = this.agentManager.get(agentId);
    if (session) session.clearHistory();

    // Clear all other agents (team workers)
    for (const agent of this.agentManager.getAll()) {
      if (agent.agentId !== agentId) {
        agent.clearHistory();
      }
    }

    this.delegationRouter.clearAll();
    this.teamPreview = null;
    this.teamChangedFiles.clear();
    this.teamFinalized = false;
  }

  // ---------------------------------------------------------------------------
  // Phase management
  // ---------------------------------------------------------------------------

  /**
   * Set a team phase explicitly (for initialization and state restoration).
   * Emits a team:phase event.
   */
  setTeamPhase(teamId: string, phase: TeamPhase, leadAgentId: string): void {
    const info = this.phaseMachine.setPhase(teamId, phase, leadAgentId);
    this.emitEvent({ type: "team:phase", teamId: info.teamId, phase: info.phase, leadAgentId: info.leadAgentId });
  }

  /**
   * Approve the plan — transitions design → execute, captures plan, creates project dir context.
   * Returns the team phase info, or null if no matching team.
   */
  approvePlan(leadAgentId: string): { teamId: string; phase: TeamPhase } | null {
    // Capture the approved plan as originalTask
    const approvedPlan = this.getLeaderLastOutput(leadAgentId);
    if (approvedPlan) {
      this.setOriginalTask(leadAgentId, approvedPlan);
    }

    const info = this.phaseMachine.approvePlan(leadAgentId);
    if (!info) return null;

    this.emitEvent({ type: "team:phase", teamId: info.teamId, phase: info.phase, leadAgentId: info.leadAgentId });
    return { teamId: info.teamId, phase: info.phase };
  }

  /**
   * Get the phase override for a team lead when running a task.
   * Handles complete → execute transition automatically.
   */
  getPhaseOverrideForLeader(leadAgentId: string): TeamPhase | undefined {
    if (!this.agentManager.isTeamLead(leadAgentId)) return undefined;
    const result = this.phaseMachine.handleUserMessage(leadAgentId);
    if (!result) return undefined;
    // If transition occurred (complete → execute), emit event
    if (result.transitioned) {
      this.emitEvent({ type: "team:phase", teamId: result.phaseInfo.teamId, phase: result.phaseOverride, leadAgentId });
    }
    return result.phaseOverride;
  }

  /**
   * Get current phase for a team leader.
   */
  getTeamPhase(leadAgentId: string): TeamPhase | undefined {
    return this.phaseMachine.getPhaseForLeader(leadAgentId)?.phase;
  }

  /**
   * Get all team phase info (for state persistence/broadcasting).
   */
  getAllTeamPhases(): Array<{ teamId: string; phase: TeamPhase; leadAgentId: string }> {
    return this.phaseMachine.getAllPhases();
  }

  /**
   * Clear a specific team's phase (FIRE_TEAM).
   */
  clearTeamPhase(teamId: string): void {
    this.phaseMachine.clear(teamId);
  }

  /**
   * Clear all team phases.
   */
  clearAllTeamPhases(): void {
    this.phaseMachine.clearAll();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    for (const agent of this.agentManager.getAll()) {
      agent.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleSessionEvent(event: OrchestratorEvent, agentId: string): void {
    // Handle retry logic on task failure (skip if timeout — retrying won't help)
    if (event.type === "task:failed" && this.retryTracker) {
      const taskId = event.taskId;
      const session = this.agentManager.get(agentId);
      const wasCancelled = event.error === "Task cancelled by user";
      const wasTimeout = session?.wasTimeout ?? false;
      const isReviewer = session?.role?.toLowerCase().includes("review") ?? false;
      if (!wasCancelled && !wasTimeout && !isReviewer && this.retryTracker.shouldRetry(taskId) && !this.delegationRouter.isDelegated(taskId)) {
        const state = this.retryTracker.recordAttempt(taskId, event.error);
        if (state) {
          this.emitEvent({
            type: "task:retrying",
            agentId,
            taskId,
            attempt: state.attempt,
            maxRetries: state.maxRetries,
            error: event.error,
          });
          const retryPrompt = this.retryTracker.getRetryPrompt(taskId);
          if (retryPrompt) {
            const session = this.agentManager.get(agentId);
            if (session) {
              // Use prependTask to insert retry at the FRONT of the queue.
              // This eliminates the race condition where dequeueDelayMs (100ms) < retryDelayMs (500ms)
              // caused user-queued messages to execute before retries, overwriting session context.
              session.prependTask(taskId, retryPrompt);
              return; // Don't emit the task:failed — we're retrying
            }
          }
        }
      }

      // Retries exhausted — check for escalation (skip on cancel)
      const escalation = wasCancelled ? null : this.retryTracker.getEscalation(taskId);
      if (escalation) {
        const leadId = this.agentManager.getTeamLead();
        if (leadId && leadId !== agentId) {
          const leadSession = this.agentManager.get(leadId);
          if (leadSession) {
            const escalationTaskId = nanoid();
            const teamContext = this.agentManager.getTeamRoster();
            leadSession.runTask(escalationTaskId, escalation.prompt, undefined, teamContext);
          }
        }
      }
      this.retryTracker.clear(taskId);
    }

    // ── Memory: record reviewer feedback for learning ──
    if (event.type === "task:done") {
      const session = this.agentManager.get(agentId);
      const role = session?.role?.toLowerCase() ?? "";
      if (role.includes("review") && event.result?.fullOutput) {
        recordReviewFeedback(event.result.fullOutput);
      }
    }

    // Detect phase transitions on task completion
    if (event.type === "task:done") {
      // create → design: leader output contains [PLAN]
      const resultText = (event.result?.summary ?? "") + (event.result?.fullOutput ?? "");
      if (resultText) {
        const phaseInfo = this.phaseMachine.checkPlanDetected(agentId, resultText);
        if (phaseInfo) {
          // Capture the plan output as originalTask so design-phase feedback has context
          const planOutput = event.result?.fullOutput ?? event.result?.summary ?? "";
          if (planOutput) {
            this.setOriginalTask(agentId, planOutput);
            console.log(`[Orchestrator] Captured plan from create phase (${planOutput.length} chars) for design context`);
          }
          this.emitEvent({ type: "team:phase", teamId: phaseInfo.teamId, phase: phaseInfo.phase, leadAgentId: phaseInfo.leadAgentId });
        }
      }
    }

    if (event.type === "task:done") {
      this.retryTracker?.clear(event.taskId);

      // Merge worktree back on successful task completion (non-leader workers only)
      const doneSession = this.agentManager.get(agentId);
      if (this.worktreeMerge && doneSession?.worktreePath && doneSession.worktreeBranch && !this.agentManager.isTeamLead(agentId)) {
        const base = doneSession.worktreePath.includes(".worktrees")
          ? require("path").dirname(require("path").dirname(doneSession.worktreePath))
          : this.workspace;
        const result = mergeWorktree(base, doneSession.worktreePath, doneSession.worktreeBranch);
        this.emitEvent({
          type: "worktree:merged",
          agentId,
          taskId: event.taskId,
          branch: doneSession.worktreeBranch,
          success: result.success,
          conflictFiles: result.conflictFiles,
          stagedFiles: result.stagedFiles,
        });
        doneSession.worktreePath = null;
        doneSession.worktreeBranch = null;
      }

      // Accumulate changedFiles from all workers (not leader, not QA/reviewer)
      if (!this.agentManager.isTeamLead(agentId) && event.result?.changedFiles) {
        for (const f of event.result.changedFiles) {
          this.teamChangedFiles.add(f);
        }
      }

      // Capture preview fields from dev workers (not reviewer, not leader).
      if (!this.agentManager.isTeamLead(agentId)) {
        const session = this.agentManager.get(agentId);
        const role = session?.role?.toLowerCase() ?? "";
        const isDevWorker = !role.includes("review");
        if (isDevWorker && event.result && (event.result.previewUrl || event.result.entryFile || event.result.previewCmd)) {
          this.teamPreview = {
            previewUrl: event.result.previewUrl,
            previewPath: event.result.previewPath,
            entryFile: event.result.entryFile,
            previewCmd: event.result.previewCmd,
            previewPort: event.result.previewPort,
          };
          console.log(`[Orchestrator] Preview captured from ${session?.name}: url=${this.teamPreview.previewUrl}, entry=${this.teamPreview.entryFile}, cmd=${this.teamPreview.previewCmd}`);
        }
      }

      // For team leaders: determine if this is the final result.
      if (this.agentManager.isTeamLead(agentId)) {
        const isResultTask = this.delegationRouter.isResultTask(event.taskId);

        // Did the leader process results WITHOUT creating new delegations?
        // This uses a delegation counter snapshot, not hasPendingFrom (which is
        // polluted by old/straggler workers still running from previous rounds).
        const leaderDidNotDelegateNewWork = isResultTask
          && this.delegationRouter.resultTaskDidNotDelegate(event.taskId);

        // Safety net: budget exhausted and no new delegations pending
        const budgetForced = this.delegationRouter.isBudgetExhausted()
          && !this.delegationRouter.hasPendingFrom(agentId);

        // Don't finalize if any worker is still actively working (safety timeout may have
        // flushed partial results while QA/reviewer is still running)
        const hasWorkingWorkers = this.agentManager.getAll().some(w =>
          w.agentId !== agentId && w.status === "working"
        );
        if (hasWorkingWorkers && !budgetForced) {
          console.log(`[Orchestrator] Deferring finalization — workers still running`);
        }
        const shouldFinalize = (leaderDidNotDelegateNewWork || budgetForced) && !this.teamFinalized && (!hasWorkingWorkers || budgetForced);

        if (shouldFinalize) {
          this.teamFinalized = true;
          event.isFinalResult = true;

          // execute → complete transition
          const completeInfo = this.phaseMachine.checkFinalResult(agentId);
          if (completeInfo) {
            this.emitEvent({ type: "team:phase", teamId: completeInfo.teamId, phase: completeInfo.phase, leadAgentId: completeInfo.leadAgentId });
          }

          // Clear any straggler delegations so they don't restart the leader later
          this.delegationRouter.clearAgent(agentId);

          // Finalize: merge team data, validate entry file, resolve preview URL
          if (event.result) {
            finalizeTeamResult({
              result: event.result,
              teamPreview: this.teamPreview,
              teamChangedFiles: this.teamChangedFiles,
              projectDir: this.delegationRouter.getTeamProjectDir(),
              workspace: this.workspace,
              detectWorkerPreview: () => {
                for (const worker of this.agentManager.getAll()) {
                  if (worker.agentId === agentId) continue;
                  const { previewUrl, previewPath } = worker.detectPreview();
                  if (previewUrl) return { previewUrl, previewPath };
                }
                return null;
              },
            });
          }

          const summary = event.result?.summary?.slice(0, CONFIG.limits.chatMessageChars) ?? "All tasks completed.";

          // ── Memory: record project completion ──
          const leaderSession = this.agentManager.get(agentId);
          const planText = leaderSession?.originalTask ?? "";
          const techMatch = planText.match(/TECH:\s*(.+)/i);
          const tech = techMatch?.[1]?.trim() ?? "unknown";
          recordProjectCompletion(summary, tech, true);
          if (tech !== "unknown") {
            recordTechPreference(tech);
          }

          this.emitEvent({
            type: "team:chat",
            fromAgentId: agentId,
            message: `Project complete: ${summary}`,
            messageType: "status",
            timestamp: Date.now(),
          });
        } else if (!isResultTask && !this.delegationRouter.hasPendingFrom(agentId)) {
          // Leader answered without delegating (e.g. user asked a question in execute phase).
          // Treat as conversational — mark as final so the frontend shows it.
          console.log(`[Orchestrator] Leader ${agentId} completed without delegations — treating as conversational reply`);
          event.isFinalResult = true;
          const completeInfo = this.phaseMachine.checkFinalResult(agentId);
          if (completeInfo) {
            this.emitEvent({ type: "team:phase", teamId: completeInfo.teamId, phase: completeInfo.phase, leadAgentId: completeInfo.leadAgentId });
          }
        }
      }
    }

    this.emitEvent(event);
  }

  private emitEvent(event: OrchestratorEvent): void {
    this.emit(event.type, event as never);
  }
}
