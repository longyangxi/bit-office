import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { AgentSession } from "./agent-session.js";
import { AgentManager } from "./agent-manager.js";
import { DelegationRouter } from "./delegation.js";
import { PromptEngine } from "./prompt-templates.js";
import { RetryTracker } from "./retry.js";
import { createWorktree, mergeWorktree, removeWorktree } from "./worktree.js";
import type { AIBackend } from "./ai-backend.js";
import type {
  OrchestratorOptions,
  CreateAgentOpts,
  CreateTeamOpts,
  RunTaskOpts,
  OrchestratorEvent,
  OrchestratorEventMap,
  Decision,
} from "./types.js";

export class Orchestrator extends EventEmitter<OrchestratorEventMap> {
  private agentManager = new AgentManager();
  private delegationRouter: DelegationRouter;
  private promptEngine: PromptEngine;
  private retryTracker: RetryTracker | null;
  private backends = new Map<string, AIBackend>();
  private defaultBackendId: string;
  private workspace: string;
  private sandboxMode: "full" | "safe";
  private worktreeEnabled: boolean;
  private worktreeMerge: boolean;
  /** Preview captured from the first dev worker that produces one — not from QA/reviewer */
  private teamPreview: { previewUrl: string; previewPath?: string } | null = null;

  constructor(opts: OrchestratorOptions) {
    super();
    this.workspace = opts.workspace;
    this.sandboxMode = opts.sandboxMode ?? "full";

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

    // Worktree
    if (opts.worktree === false) {
      this.worktreeEnabled = false;
      this.worktreeMerge = false;
    } else {
      this.worktreeEnabled = true;
      this.worktreeMerge = opts.worktree?.mergeOnComplete ?? true;
    }
  }

  // ---------------------------------------------------------------------------
  // Agent lifecycle
  // ---------------------------------------------------------------------------

  createAgent(opts: CreateAgentOpts): void {
    const backend = this.backends.get(opts.backend ?? this.defaultBackendId)
      ?? this.backends.get(this.defaultBackendId)!;

    const session = new AgentSession({
      agentId: opts.agentId,
      name: opts.name,
      role: opts.role,
      personality: opts.personality,
      workspace: this.workspace,
      resumeHistory: opts.resumeHistory,
      backend,
      sandboxMode: this.sandboxMode,
      isTeamLead: this.agentManager.isTeamLead(opts.agentId),
      teamId: opts.teamId,
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
      session.originalTask = prompt;
      this.delegationRouter.clearAll();
      this.teamPreview = null;
    }

    // Track for retry
    this.retryTracker?.track(taskId, prompt);

    // Worktree setup
    if (this.worktreeEnabled && !session.worktreePath) {
      const wt = createWorktree(this.workspace, agentId, taskId, session.name);
      if (wt) {
        const branch = `agent/${session.name.toLowerCase().replace(/\s+/g, "-")}/${taskId}`;
        session.worktreePath = wt;
        session.worktreeBranch = branch;
        this.emitEvent({
          type: "worktree:created",
          agentId,
          taskId,
          worktreePath: wt,
          branch,
        });
      }
    }

    const repoPath = session.worktreePath ?? opts?.repoPath;
    // Only the team lead gets the full roster (to decide delegation).
    // Workers don't need it — they just do their assigned task.
    const teamContext = this.agentManager.isTeamLead(agentId)
      ? this.agentManager.getTeamRoster()
      : undefined;

    session.runTask(taskId, prompt, repoPath, teamContext, true /* isUserInitiated */);
  }

  cancelTask(agentId: string): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;

    // Clean up worktree on cancel
    if (session.worktreePath && session.worktreeBranch) {
      removeWorktree(session.worktreePath, session.worktreeBranch, this.workspace);
      session.worktreePath = null;
      session.worktreeBranch = null;
    }

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
      this.cancelTask(agent.agentId);
    }
    for (const agent of teamAgents) {
      this.agentManager.delete(agent.agentId);
      this.emitEvent({ type: "agent:fired", agentId: agent.agentId });
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
    return { agentId: s.agentId, name: s.name, role: s.role, status: s.status, palette: s.palette, backend: s.backend.id, pid: s.pid };
  }

  getAllAgents() {
    return this.agentManager.getAll().map(s => ({
      agentId: s.agentId, name: s.name, role: s.role, status: s.status,
      palette: s.palette, backend: s.backend.id, pid: s.pid,
      isTeamLead: this.agentManager.isTeamLead(s.agentId),
      teamId: s.teamId,
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

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    for (const agent of this.agentManager.getAll()) {
      if (agent.worktreePath && agent.worktreeBranch) {
        removeWorktree(agent.worktreePath, agent.worktreeBranch, this.workspace);
      }
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
      if (!wasCancelled && !wasTimeout && this.retryTracker.shouldRetry(taskId) && !this.delegationRouter.isDelegated(taskId)) {
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
              setTimeout(() => session.runTask(taskId, retryPrompt), 500);
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

    // Handle worktree merge on task completion
    if (event.type === "task:done") {
      const session = this.agentManager.get(agentId);
      if (session?.worktreePath && session.worktreeBranch) {
        if (this.worktreeMerge) {
          const result = mergeWorktree(this.workspace, session.worktreePath, session.worktreeBranch);
          this.emitEvent({
            type: "worktree:merged",
            agentId,
            taskId: event.taskId,
            branch: session.worktreeBranch,
            success: result.success,
            conflictFiles: result.conflictFiles,
          });
        } else {
          removeWorktree(session.worktreePath, session.worktreeBranch, this.workspace);
        }
        session.worktreePath = null;
        session.worktreeBranch = null;
      }

      this.retryTracker?.clear(event.taskId);

      // Capture preview from dev workers as soon as they complete.
      // Only dev workers (not QA, not reviewer, not leader) should set preview.
      // First valid preview wins — don't overwrite with later workers.
      if (!this.agentManager.isTeamLead(agentId) && !this.teamPreview) {
        const role = session?.role?.toLowerCase() ?? "";
        const isDevWorker = !role.includes("qa") && !role.includes("tester") && !role.includes("review");
        if (isDevWorker && event.result?.previewUrl) {
          this.teamPreview = {
            previewUrl: event.result.previewUrl,
            previewPath: event.result.previewPath,
          };
          console.log(`[Orchestrator] Preview captured from ${session?.name}: ${this.teamPreview.previewUrl}`);
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

        const shouldFinalize = leaderDidNotDelegateNewWork || budgetForced;

        if (shouldFinalize) {
          event.isFinalResult = true;

          // Clear any straggler delegations so they don't restart the leader later
          this.delegationRouter.clearAgent(agentId);

          // Use preview captured earlier from dev workers
          if (!event.result?.previewUrl && this.teamPreview && event.result) {
            event.result.previewUrl = this.teamPreview.previewUrl;
            event.result.previewPath = this.teamPreview.previewPath;
          }

          // Fallback: no dev worker had a preview — scan all workers' changedFiles for .html
          if (!event.result?.previewUrl && event.result) {
            for (const worker of this.agentManager.getAll()) {
              if (worker.agentId === agentId) continue;
              const { previewUrl, previewPath } = worker.detectPreview();
              if (previewUrl) {
                event.result.previewUrl = previewUrl;
                event.result.previewPath = previewPath;
                break;
              }
            }
          }

          const summary = event.result?.summary?.slice(0, 200) ?? "All tasks completed.";
          this.emitEvent({
            type: "team:chat",
            fromAgentId: agentId,
            message: `Project complete: ${summary}`,
            messageType: "status",
            timestamp: Date.now(),
          });
        } else if (!isResultTask && !this.delegationRouter.hasPendingFrom(agentId)) {
          console.warn(`[Orchestrator] Leader ${agentId} completed initial task with no delegations. Output may have failed to parse.`);
        }
      }
    }

    // Handle worktree cleanup on task failure (after retry logic)
    if (event.type === "task:failed") {
      const session = this.agentManager.get(agentId);
      if (session?.worktreePath && session.worktreeBranch) {
        removeWorktree(session.worktreePath, session.worktreeBranch, this.workspace);
        session.worktreePath = null;
        session.worktreeBranch = null;
      }
    }

    this.emitEvent(event);
  }

  private emitEvent(event: OrchestratorEvent): void {
    this.emit(event.type, event as never);
  }
}
