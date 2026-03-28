import { EventEmitter } from "events";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { CONFIG } from "./config.js";
import { AgentSession, clearSessionId } from "./agent-session.js";
import { AgentManager } from "./agent-manager.js";
import { DelegationRouter } from "./delegation.js";
import { PromptEngine } from "./prompt-templates.js";
import { ReactionEngine, DEFAULT_RULES } from "./reaction/index.js";
import { StuckDetector } from "./stuck-detector.js";
import type { ReactionContext, AgentSessionFacade, OrchestratorFacade } from "./reaction/index.js";
import type { Notifier } from "./notifier/types.js";
import { PhaseMachine } from "./phase-machine.js";
import { finalizeTeamResult } from "./result-finalizer.js";
import { shouldAutoReview, buildReviewPrompt } from "./auto-reviewer.js";
import { TaskScheduler, tryParseDecomposition } from "./decomposer/index.js";
import type { DecompositionPlan, TaskNode } from "./decomposer/index.js";
import { recordReviewFeedback, recordProjectCompletion, recordTechPreference, getMemoryContext } from "./memory.js";
import { getManagedWorktreeBranch, resetWorktreeToMain, isGitRepo, initGitRepo } from "./worktree.js";
import { WorktreeWorkspace } from "./workspace/index.js";
import { selectAgent } from "./agent-selector.js";
import type { Workspace } from "./workspace/types.js";
import type { AIBackend } from "./ai-backend.js";
import type { TeamPreview } from "./result-finalizer.js";
import type {
  OrchestratorOptions,
  CreateAgentOpts,
  CreateTeamOpts,
  RunTaskOpts,
  OrchestratorEvent,
  OrchestratorEventMap,
  TaskResultPayload,
  TeamPhase,
  Decision,
} from "./types.js";

export class Orchestrator extends EventEmitter<OrchestratorEventMap> {
  private agentManager = new AgentManager();
  private delegationRouter: DelegationRouter;
  private promptEngine: PromptEngine;
  private reactionEngine: ReactionEngine;
  private stuckDetector: StuckDetector;
  private phaseMachine = new PhaseMachine();
  private backends = new Map<string, AIBackend>();
  private defaultBackendId: string;
  private workspace: string;
  private sandboxMode: "full" | "safe";
  private workspaceAdapter: Workspace;
  private worktreeEnabled: boolean;
  private worktreeMerge: boolean;
  private worktreeAlwaysIsolate: boolean;
  get isWorktreeEnabled(): boolean { return this.worktreeEnabled; }
  /** Enable/disable worktree isolation at runtime. Updates both enabled and alwaysIsolate flags. */
  setWorktreeEnabled(v: boolean): void {
    this.worktreeEnabled = v;
    if (v) {
      this.worktreeMerge = true;
      this.worktreeAlwaysIsolate = true;
    } else {
      this.worktreeAlwaysIsolate = false;
      // Clear worktree paths on running agents so they stop using stale worktrees
      for (const session of this.agentManager.getAll()) {
        if (session.worktreePath) {
          session.worktreePath = null;
          session.worktreeBranch = null;
        }
      }
    }
  }
  /** Preview info captured from the first dev worker that produces one — not from QA/reviewer */
  private teamPreview: TeamPreview | null = null;
  /** Accumulated changedFiles from all workers in the current team session */
  private teamChangedFiles = new Set<string>();
  /** Guard against emitting isFinalResult more than once per execute cycle. */
  private teamFinalized = false;
  /** Active decomposition scheduler (null when using legacy delegation) */
  private activeScheduler: TaskScheduler | null = null;
  private activePlan: DecompositionPlan | null = null;
  private notifier: Notifier | null = null;
  private autoReview = false;
  /** Queue of pending review tasks */
  private reviewQueue: Array<{ devAgentId: string; taskId: string; prompt: string }> = [];
  private reviewerBusy = false;

  constructor(opts: OrchestratorOptions) {
    super();
    this.workspace = opts.workspace;
    this.sandboxMode = opts.sandboxMode ?? "full";

    // Worktree isolation
    if (opts.worktree === false) {
      this.worktreeEnabled = false;
      this.worktreeMerge = false;
      this.worktreeAlwaysIsolate = false;
    } else {
      this.worktreeEnabled = true;
      this.worktreeMerge = opts.worktree?.mergeOnComplete ?? true;
      this.worktreeAlwaysIsolate = opts.worktree?.alwaysIsolate ?? false;
    }

    // Workspace plugin
    this.workspaceAdapter = new WorktreeWorkspace(
      opts.worktree && typeof opts.worktree === "object" && opts.worktree.postCreate
        ? { postCreate: opts.worktree.postCreate }
        : undefined,
    );

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
      (agentId, taskId, repoPath) => this.setupWorktreeForAgent(agentId, taskId, repoPath),
    );

    // Reaction engine (replaces RetryTracker)
    this.reactionEngine = new ReactionEngine({
      rules: opts.reactions ?? DEFAULT_RULES,
    });
    this.autoReview = opts.autoReview ?? false;

    if (opts.notifier) {
      this.notifier = opts.notifier;
    }

    // Stuck detector: polls working agents, fires reaction engine on idle > threshold
    this.stuckDetector = new StuckDetector({
      thresholdMs: 300_000,
      pollIntervalMs: 60_000,
      getWorkingAgents: () => {
        const result: { agentId: string; lastOutputAt: number; taskId: string }[] = [];
        for (const session of this.agentManager.getAll()) {
          if (session.status === "working" && session.lastOutputAt > 0) {
            result.push({
              agentId: session.agentId,
              lastOutputAt: session.lastOutputAt,
              taskId: session.currentTask ?? "unknown",
            });
          }
        }
        return result;
      },
      onStuck: (agentId, taskId) => {
        const session = this.agentManager.get(agentId);
        if (!session) return;
        this.reactionEngine.handle("agent:stuck", {
          agentId,
          taskId,
          error: `Agent ${session.name} idle for 5+ minutes`,
          role: session.role,
          session: this.buildSessionFacade(session),
          orchestrator: this.buildOrchestratorFacade(),
        });
      },
    });
    this.stuckDetector.start();
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
      model: opts.model,
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
      autoMerge: session.autoMerge,
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
      this.workspaceAdapter.destroy(session.workspaceDir, session.worktreePath, session.worktreeBranch);
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

  setAutoReview(enabled: boolean): void {
    this.autoReview = enabled;
  }

  getAutoReview(): boolean {
    return this.autoReview;
  }

  createTeam(opts: CreateTeamOpts): void {
    const presets = [
      { ...opts.memberPresets[opts.leadPresetIndex] ?? opts.memberPresets[0], isLead: true },
      ...opts.memberPresets.filter((_, i) => i !== opts.leadPresetIndex).map(p => ({ ...p, isLead: false })),
    ];

    const teamId = `team-${nanoid(6)}`;
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
        teamId,
      });

      if ((preset as { isLead: boolean }).isLead) {
        leadAgentId = agentId;
        this.agentManager.setTeamLead(agentId);
      }
    }

    // Auto-enable review if team has a reviewer role
    if (!this.autoReview) {
      const hasReviewer = presets.some(p => p.role?.toLowerCase().includes("review"));
      if (hasReviewer) {
        this.autoReview = true;
        console.log("[Orchestrator] Auto-enabled review: team has a reviewer member");
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
      this.activeScheduler = null;
      this.activePlan = null;
    }

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

    // Worktree isolation: create a branch for each non-leader, non-reviewer agent.
    // When worktree is disabled, agents work directly in the designated directory on the current branch.
    // NOTE: Claude Code's native --worktree flag is incompatible with -p and --resume
    // (causes exit code 1). All backends use managed worktrees (~/.open-office[-dev]/worktrees/) instead.
    this.setupWorktreeForAgent(agentId, taskId, repoPath ?? session.workspaceDir);

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
   * Create a worktree for an agent's task (if worktree is enabled).
   * Skips leaders and reviewers. Called from both runTask() and delegation.
   */
  private setupWorktreeForAgent(agentId: string, taskId: string, repoPath?: string): void {
    if (!this.worktreeEnabled) return;
    const session = this.agentManager.get(agentId);
    if (!session) return;
    // If worktree already exists, sync it to latest main before agent starts working
    // Skip sync if agent has pending unmerged changes — rebase could silently lose them
    if (session.worktreePath) {
      if (!session.pendingMerge) {
        this.workspaceAdapter.sync(session.workspaceDir, session.worktreePath);
      }
      return;
    }
    if (this.agentManager.isTeamLead(agentId)) return;
    if (session.role.toLowerCase().includes("review")) return;

    // Solo agents: create worktree when alwaysIsolate is on, or when a neighbor is working in the same dir.
    if (!session.teamId && !this.worktreeAlwaysIsolate) {
      const effectiveRepo = repoPath ?? session.workspaceDir;
      if (!this.hasSoloNeighbor(agentId, effectiveRepo)) return;
    }

    const base = repoPath ?? session.workspaceDir;

    // Non-git workspaces: auto-init git so worktree isolation + undo work
    if (!isGitRepo(base)) {
      if (!initGitRepo(base)) return;
    }

    const instanceDir = process.env.BIT_OFFICE_INSTANCE_DIR;
    const owner = instanceDir
      ? {
        gatewayId: process.env.BIT_OFFICE_GATEWAY_ID ?? "unknown",
        machineId: process.env.BIT_OFFICE_MACHINE_ID ?? "unknown",
        instanceDir,
        pid: Number(process.env.BIT_OFFICE_GATEWAY_PID) || process.pid,
        startedAt: Number(process.env.BIT_OFFICE_GATEWAY_STARTED_AT) || Date.now(),
      }
      : undefined;
    const wtInfo = this.workspaceAdapter.create({ repoRoot: base, agentId, agentName: session.name, owner });
    if (wtInfo) {
      session.worktreePath = wtInfo.path;
      session.worktreeBranch = wtInfo.branch;
      // Clear history — can't --resume in a different directory
      session.clearHistory();
      this.emitEvent({ type: "worktree:created", agentId, taskId, worktreePath: wtInfo.path, branch: wtInfo.branch });
    } else {
      console.warn(`[Orchestrator] Worktree creation failed for ${session.name} (${agentId}), falling back to main workspace`);
      this.emitEvent({
        type: "team:chat",
        fromAgentId: agentId,
        message: `Worktree isolation disabled for ${session.name}: could not create worktree. Agent will work directly in the main workspace.`,
        messageType: "warning",
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Merge all worker worktrees back to the main branch (called on team finalization).
   */
  private mergeAllWorkerWorktrees(leaderAgentId: string): void {
    const leader = this.agentManager.get(leaderAgentId);
    const teamId = leader?.teamId;
    for (const session of this.agentManager.getAll()) {
      if (session.agentId === leaderAgentId) continue;
      if (!session.worktreePath || !session.worktreeBranch) continue;
      // Only merge workers from the same team — skip solo agents or other teams
      if (teamId && session.teamId !== teamId) continue;
      const result = this.workspaceAdapter.merge(session.workspaceDir, session.worktreePath, session.worktreeBranch, {
        keepAlive: false, summary: session.lastSummary ?? undefined, agentName: session.name, agentId: session.agentId,
      });
      this.emitEvent({
        type: "worktree:merged",
        agentId: session.agentId,
        taskId: "finalize",
        branch: session.worktreeBranch,
        success: result.success,
        conflictFiles: result.conflictFiles,
        stagedFiles: result.stagedFiles,
      });
      if (!result.success) {
        const conflictList = result.conflictFiles?.length
          ? `: ${result.conflictFiles.join(", ")}`
          : "";
        this.emitEvent({
          type: "team:chat",
          fromAgentId: session.agentId,
          message: `Merge conflict — ${session.name}'s changes could not be merged to main${conflictList}. Manual resolution needed.`,
          messageType: "warning",
          timestamp: Date.now(),
        });
      }
      session.worktreePath = null;
      session.worktreeBranch = null;
    }
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

  /** Check if another solo agent (no teamId) is actively working in the same repoPath. */
  private hasSoloNeighbor(agentId: string, repoPath: string): boolean {
    for (const other of this.agentManager.getAll()) {
      if (other.agentId === agentId || other.teamId) continue;
      if (other.status !== "working") continue;
      if (other.workspaceDir === repoPath) return true;
    }
    return false;
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
    this.reviewQueue.length = 0;
    this.reviewerBusy = false;
    this.pendingDispatch.length = 0;
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
    this.reviewQueue.length = 0;
    this.reviewerBusy = false;
    this.pendingDispatch.length = 0;
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
      palette: s.palette, personality: s.personality, backend: s.backend.id, model: s.model, pid: s.pid,
      isTeamLead: this.agentManager.isTeamLead(s.agentId),
      teamId: s.teamId,
      worktreePath: s.worktreePath,
      worktreeBranch: s.worktreeBranch,
      autoMerge: s.autoMerge,
      pendingMerge: s.pendingMerge,
      lastMergeCommit: s.mergeCommitStack.length > 0 ? s.mergeCommitStack[s.mergeCommitStack.length - 1].hash : null,
      lastMergeMessage: s.mergeCommitStack.length > 0 ? s.mergeCommitStack[s.mergeCommitStack.length - 1].message : null,
      mergeCommitStack: s.mergeCommitStack,
      undoCount: s.mergeCommitStack.length,
    }));
  }

  /** Manually merge an agent's worktree branch back to main */
  mergeAgentWorktree(agentId: string): { success: boolean; conflictFiles?: string[] } {
    const session = this.agentManager.get(agentId);
    if (!session?.worktreePath || !session.worktreeBranch) {
      return { success: false };
    }
    if (session.status === "working") {
      this.emitEvent({
        type: "team:chat",
        fromAgentId: agentId,
        message: `Cannot merge while ${session.name} is working. Wait for the task to finish first.`,
        messageType: "warning",
        timestamp: Date.now(),
      });
      return { success: false };
    }
    const result = this.workspaceAdapter.merge(session.workspaceDir, session.worktreePath, session.worktreeBranch, {
      keepAlive: true, summary: session.lastSummary ?? undefined, agentName: session.name, agentId: session.agentId,
    });
    if (result.success) {
      session.pendingMerge = false;
      if (result.commitHash) session.mergeCommitStack.push({ hash: result.commitHash, message: result.commitMessage ?? "merge" });
    }
    this.emitEvent({
      type: "worktree:merged",
      agentId,
      taskId: "manual",
      branch: session.worktreeBranch,
      success: result.success,
      commitHash: result.commitHash,
      commitMessage: result.commitMessage,
      conflictFiles: result.conflictFiles,
      stagedFiles: result.stagedFiles,
    });
    if (!result.success) {
      const conflictList = result.conflictFiles?.length ? `: ${result.conflictFiles.join(", ")}` : "";
      this.emitEvent({
        type: "team:chat",
        fromAgentId: agentId,
        message: `Merge conflict — ${session.name}'s changes could not be merged to main${conflictList}. Manual resolution needed.`,
        messageType: "warning",
        timestamp: Date.now(),
      });
    }
    return { success: result.success, conflictFiles: result.conflictFiles };
  }

  /** Revert the last commit on an agent's worktree branch */
  revertAgentWorktree(agentId: string): { success: boolean; commitId?: string; commitsAhead: number; message?: string } {
    const session = this.agentManager.get(agentId);
    if (!session?.worktreePath || !session.worktreeBranch) {
      return { success: false, commitsAhead: -1, message: "No worktree" };
    }
    if (session.status === "working") {
      return { success: false, commitsAhead: -1, message: "Agent is working" };
    }
    const result = this.workspaceAdapter.revert(session.workspaceDir, session.worktreePath);
    if (result.success && result.commitsAhead === 0) {
      session.pendingMerge = false;
    }
    return result;
  }

  /** Detect and set pendingMerge for agents whose worktree has unmerged changes (e.g. after restart) */
  detectPendingMerges(): void {
    for (const session of this.agentManager.getAll()) {
      if (session.worktreePath && session.worktreeBranch && !session.teamId) {
        if (this.workspaceAdapter.hasPendingChanges(session.workspaceDir, session.worktreePath)) {
          if (this.worktreeMerge && session.autoMerge) {
            // Auto-merge agents: merge immediately instead of showing pending UI
            const result = this.workspaceAdapter.merge(session.workspaceDir, session.worktreePath, session.worktreeBranch, {
              keepAlive: true, summary: session.lastSummary ?? undefined, agentName: session.name, agentId: session.agentId,
            });
            if (result.success && result.commitHash) {
              session.mergeCommitStack.push({ hash: result.commitHash, message: result.commitMessage ?? "merge" });
            }
            this.emitEvent({
              type: "worktree:merged",
              agentId: session.agentId,
              taskId: "restore",
              branch: session.worktreeBranch,
              success: result.success,
              commitHash: result.commitHash,
              commitMessage: result.commitMessage,
            });
            if (!result.success) {
              // Merge failed — fall back to manual merge UI
              session.pendingMerge = true;
              this.emitEvent({
                type: "worktree:ready",
                agentId: session.agentId,
                taskId: "restore",
                branch: session.worktreeBranch,
              });
            }
            console.log(`[Worktree] Auto-merged pending changes for ${session.name} on ${session.worktreeBranch} (success=${result.success})`);
          } else {
            session.pendingMerge = true;
            this.emitEvent({
              type: "worktree:ready",
              agentId: session.agentId,
              taskId: "restore",
              branch: session.worktreeBranch,
            });
            console.log(`[Worktree] Detected pending changes for ${session.name} on ${session.worktreeBranch}`);
          }
        }
      }
    }
  }

  /** Restore worktree state for an agent (used on gateway restart) */
  restoreAgentWorktree(agentId: string, worktreePath: string, worktreeBranch: string): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    session.worktreePath = worktreePath;
    session.worktreeBranch = worktreeBranch;
  }

  /** Restore merge commit history for an agent (used on gateway restart) */
  restoreAgentMergeHistory(agentId: string, stack: { hash: string; message: string }[]): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    session.mergeCommitStack = stack;
  }

  /** Undo the last merge from an agent (reset the merge commit on main) */
  undoAgentMerge(agentId: string): { success: boolean; message?: string } {
    const session = this.agentManager.get(agentId);
    if (!session?.mergeCommitStack.length) {
      return { success: false, message: "No merge to undo" };
    }
    const entry = session.mergeCommitStack[session.mergeCommitStack.length - 1];
    const result = this.workspaceAdapter.undoMerge(session.workspaceDir, entry.hash);
    if (result.success) {
      session.mergeCommitStack.pop();
      // Sync agent worktree to new main HEAD to eliminate branch fork (only needed for reset)
      if (result.method === "reset" && session.worktreePath) {
        try {
          resetWorktreeToMain(session.workspaceDir, session.worktreePath);
          console.log(`[Worktree] Synced ${session.name}'s worktree to main after undo merge`);
        } catch (err) {
          console.warn(`[Worktree] Failed to sync worktree after undo merge: ${(err as Error).message}`);
        }
      }
    }
    return result;
  }

  /** Toggle auto-merge for a specific agent */
  setAgentAutoMerge(agentId: string, autoMerge: boolean): void {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    session.autoMerge = autoMerge;

    // If turning ON and agent has pending merge, auto-merge immediately
    if (autoMerge && this.worktreeMerge && session.pendingMerge
      && session.worktreePath && session.worktreeBranch) {
      session.pendingMerge = false;
      const result = this.workspaceAdapter.merge(session.workspaceDir, session.worktreePath, session.worktreeBranch, {
        keepAlive: true, summary: session.lastSummary ?? undefined, agentName: session.name, agentId: session.agentId,
      });
      if (result.success && result.commitHash) {
        session.mergeCommitStack.push({ hash: result.commitHash, message: result.commitMessage ?? "merge" });
      }
      this.emitEvent({
        type: "worktree:merged",
        agentId,
        taskId: "auto-merge-toggle",
        branch: session.worktreeBranch,
        success: result.success,
        commitHash: result.commitHash,
        commitMessage: result.commitMessage,
        conflictFiles: result.conflictFiles,
        stagedFiles: result.stagedFiles,
      });
      if (!result.success) {
        // Merge failed — restore pendingMerge so user can retry manually
        session.pendingMerge = true;
        this.emitEvent({
          type: "team:chat",
          fromAgentId: agentId,
          message: `Auto-merge failed for ${session.name} — manual resolution needed.`,
          messageType: "warning",
          timestamp: Date.now(),
        });
      }
      console.log(`[Worktree] Auto-merged pending changes for ${session.name} on toggle (success=${result.success})`);
    }

    this.emitEvent({ type: "autoMerge:updated", agentId, autoMerge });
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
    this.activeScheduler = null;
    this.activePlan = null;
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
    this.stuckDetector.stop();
    for (const agent of this.agentManager.getAll()) {
      agent.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private buildSessionFacade(session: AgentSession): AgentSessionFacade {
    return {
      prependTask: (taskId, prompt) => session.prependTask(taskId, prompt),
      getAgentId: () => session.agentId,
      getRole: () => session.role ?? "",
    };
  }

  private buildOrchestratorFacade(): OrchestratorFacade {
    return {
      getTeamLead: () => {
        const leadId = this.agentManager.getTeamLead();
        if (!leadId) return null;
        const leadSession = this.agentManager.get(leadId);
        return leadSession ? this.buildSessionFacade(leadSession) : null;
      },
      runTask: (agentId, taskId, prompt) => this.runTask(agentId, taskId, prompt),
      forceFinalize: (agentId) => {
        this.emitEvent({
          type: "task:done",
          agentId,
          taskId: "forced",
          result: {
            summary: "Force-finalized by reaction engine (budget exceeded)",
            changedFiles: [],
            diffStat: "",
            testResult: "unknown",
          },
          isFinalResult: true,
        });
      },
      emitNotification: (notification) => {
        this.emitEvent({
          type: "notification",
          title: notification.title,
          message: notification.message,
          priority: notification.priority,
          agentId: notification.agentId,
          taskId: notification.taskId,
        });
      },
      notifier: this.notifier ?? undefined,
    };
  }

  private handleSessionEvent(event: OrchestratorEvent, agentId: string): void {
    try {
      this._handleSessionEventUnsafe(event, agentId);
    } catch (err) {
      console.error(`[Orchestrator] Uncaught error in handleSessionEvent for agent ${agentId}, event ${event.type}:`, err);
    }
  }

  private _handleSessionEventUnsafe(event: OrchestratorEvent, agentId: string): void {
    // ── Scheduler-managed task completion ──
    if (this.activeScheduler && this.activePlan) {
      if (event.type === "task:done") {
        const taskId = event.taskId;
        if (this.activePlan.tree.children.some(c => c.id === taskId)) {
          this.activeScheduler.taskCompleted(taskId, event.result?.summary);
          // Don't check completion here — defer until after auto-review queueing
          // so that reviews are queued before we decide if the plan is fully done.
          // Don't return — let the normal task:done processing continue
          // (worktree merge, memory recording, auto-review, etc. still needed for workers)
        }
      }
      if (event.type === "task:failed") {
        const taskId = event.taskId;
        if (this.activePlan.tree.children.some(c => c.id === taskId)) {
          this.activeScheduler.taskFailed(taskId, event.error);
          // Don't check completion here — defer until after auto-review queueing
          // Don't return — let reaction engine handle the failure
        }
      }
    }

    // Handle retry/escalation logic on task failure via ReactionEngine
    if (event.type === "task:failed") {
      const taskId = event.taskId;
      const session = this.agentManager.get(agentId);
      if (session) {
        const isReviewer = session.role?.toLowerCase().includes("review") ?? false;
        const ctx: ReactionContext = {
          agentId,
          taskId,
          error: event.error,
          role: session.role,
          wasTimeout: session.wasTimeout ?? false,
          wasCancellation: event.error === "Task cancelled by user",
          isDelegated: this.delegationRouter.isDelegated(taskId),
          isReviewer,
          originalPrompt: session.lastPrompt,
          session: this.buildSessionFacade(session),
          orchestrator: this.buildOrchestratorFacade(),
        };
        const result = this.reactionEngine.handle("task:failed", ctx);
        if (result.action === "retry") {
          this.emitEvent({
            type: "task:retrying",
            agentId,
            taskId,
            attempt: result.attempt ?? 1,
            maxRetries: result.maxRetries ?? 2,
            error: event.error,
          });
          return; // Don't emit task:failed — we're retrying
        }
      }
    }

    // ── Dispatch queued tasks when an agent becomes available ──
    if ((event.type === "task:done" || event.type === "task:failed") && this.pendingDispatch.length > 0) {
      // The finishing agent may still be in "done" status; defer so it transitions to "idle" first
      setTimeout(() => this.drainPendingDispatch(), 100);
    }

    // ── Memory: record reviewer feedback for learning ──
    if (event.type === "task:done") {
      const session = this.agentManager.get(agentId);
      const role = session?.role?.toLowerCase() ?? "";
      if (role.includes("review") && event.result?.fullOutput) {
        recordReviewFeedback(event.result.fullOutput);
      }
    }

    // ── Auto-review: queue review for completed dev tasks ──
    if (event.type === "task:done" && this.autoReview) {
      const session = this.agentManager.get(agentId);
      if (session) {
        const isTeamLead = this.agentManager.isTeamLead(agentId);
        // Only check for reviewer within the same team
        const devTeamId = session.teamId;
        const hasReviewer = this.agentManager.getAll().some(
          s => (s.role ?? "").toLowerCase().includes("review")
            && !this.agentManager.isTeamLead(s.agentId)
            && (devTeamId ? s.teamId === devTeamId : true)
        );

        if (shouldAutoReview({
          autoReview: this.autoReview,
          role: session.role ?? "",
          isTeamLead,
          hasReviewer,
        })) {
          this.queueAutoReview(agentId, event.taskId, event.result);
        }
      }
    }

    // ── Scheduler completion check (deferred from task completion above) ──
    // Must run AFTER auto-review queueing so pending reviews block premature finalization.
    if ((event.type === "task:done" || event.type === "task:failed") && this.activeScheduler && this.activePlan) {
      this.checkSchedulerCompletion();
    }

    // ── Auto-review: handle reviewer completion ──
    if (event.type === "task:done" || event.type === "task:failed") {
      const session = this.agentManager.get(agentId);
      if (session && (session.role ?? "").toLowerCase().includes("review")) {
        // Route VERDICT:FAIL back to the dev who wrote the code
        if (event.type === "task:done") {
          const devAgentId = this.delegationRouter.getAutoReviewDevAgent(event.taskId);
          if (devAgentId && event.result?.fullOutput) {
            const verdictMatch = event.result.fullOutput.match(/VERDICT[:\s]*(\w+)/i);
            if (verdictMatch && verdictMatch[1].toUpperCase() === "FAIL") {
              console.log(`[AutoReview] FAIL verdict for ${devAgentId}, routing fix via reaction engine`);
              this.emitEvent({
                type: "review:fail",
                agentId,
                taskId: event.taskId,
                reviewerOutput: event.result.fullOutput,
                devAgentId,
              });
              // Actually invoke the reaction engine to dispatch fix to dev
              const devSession = this.agentManager.get(devAgentId);
              if (devSession) {
                const fixTaskId = `fix-${nanoid(6)}`;
                this.reactionEngine.handle("review:fail", {
                  agentId,
                  taskId: fixTaskId,
                  role: session.role,
                  reviewerOutput: event.result.fullOutput,
                  devAgentId,
                  session: this.buildSessionFacade(session),
                  orchestrator: this.buildOrchestratorFacade(),
                });
              }
            }
          }
        }
        this.reviewerBusy = false;
        this.processReviewQueue();
        this.checkSchedulerCompletion();
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

    // ── Decomposition: detect [DECOMPOSITION] in leader output ──
    if (event.type === "task:done" && this.agentManager.isTeamLead(agentId)) {
      const output = event.result?.fullOutput ?? event.result?.summary ?? "";
      const leaderSession = this.agentManager.get(agentId);
      const rootTask = leaderSession?.originalTask ?? event.result?.summary ?? "";
      const plan = tryParseDecomposition(output, rootTask);

      if (plan) {
        console.log(`[Orchestrator] [DECOMPOSITION] detected: ${plan.tree.children.length} tasks in ${plan.groups.length} groups`);
        this.activePlan = plan;
        this.activeScheduler = new TaskScheduler(plan, (task, contextPrompt) => {
          this.dispatchDecomposedTask(task, contextPrompt);
        });
        this.activeScheduler.start();
        // Emit the leader's task:done so UI updates, but don't fall through to
        // finalization logic — workers take over from here.
        this.emitEvent(event);
        return;
      }
      // No [DECOMPOSITION] block — fall through to legacy delegation handling
    }

    if (event.type === "task:done") {
      this.reactionEngine.clearTask(event.taskId);

      // Worktree merge strategy:
      // - Team workers: keep worktree alive, merge all at once when team result is finalized.
      // - Solo agents: merge changes back but keep worktree alive for session continuity.
      //   Worktree is only cleaned up when agent is removed or gateway restarts (GC).
      const doneSession = this.agentManager.get(agentId);
      if (doneSession?.worktreePath && doneSession.worktreeBranch
        && !this.agentManager.isTeamLead(agentId) && !doneSession.teamId) {
        if (this.worktreeMerge && doneSession.autoMerge) {
          // Auto-merge: merge immediately as before
          doneSession.pendingMerge = false;
          const summary = event.result?.summary;
          const result = this.workspaceAdapter.merge(doneSession.workspaceDir, doneSession.worktreePath, doneSession.worktreeBranch, {
            keepAlive: true, summary, agentName: doneSession.name, agentId: doneSession.agentId,
          });
          if (result.success && result.commitHash) {
            doneSession.mergeCommitStack.push({ hash: result.commitHash, message: result.commitMessage ?? "merge" });
          }
          this.emitEvent({
            type: "worktree:merged",
            agentId,
            taskId: event.taskId,
            branch: doneSession.worktreeBranch,
            success: result.success,
            commitHash: result.commitHash,
            commitMessage: result.commitMessage,
            conflictFiles: result.conflictFiles,
            stagedFiles: result.stagedFiles,
          });
          if (!result.success) {
            // Merge failed — restore pendingMerge so user can retry manually
            doneSession.pendingMerge = true;
            this.emitEvent({
              type: "worktree:ready",
              agentId,
              taskId: event.taskId,
              branch: doneSession.worktreeBranch!,
            });
            const conflictList = result.conflictFiles?.length
              ? `: ${result.conflictFiles.join(", ")}`
              : "";
            this.emitEvent({
              type: "team:chat",
              fromAgentId: agentId,
              message: `Merge conflict — ${doneSession.name}'s changes could not be merged to main${conflictList}. Manual resolution needed.`,
              messageType: "warning",
              timestamp: Date.now(),
            });
          }
        } else {
          // Deferred merge: signal that worktree is ready for manual merge
          doneSession.pendingMerge = true;
          this.emitEvent({
            type: "worktree:ready",
            agentId,
            taskId: event.taskId,
            branch: doneSession.worktreeBranch,
          });
        }
        // Keep worktreePath/worktreeBranch set — next task reuses the same worktree
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

          // Merge all worker worktrees back to main branch
          if (this.worktreeMerge) {
            this.mergeAllWorkerWorktrees(agentId);
          }

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

  // ---------------------------------------------------------------------------
  // Decomposition scheduler helpers
  // ---------------------------------------------------------------------------

  /** Tasks waiting for an agent to become available */
  private pendingDispatch: Array<{ task: TaskNode; contextPrompt: string }> = [];

  private drainPendingDispatch(): void {
    if (this.pendingDispatch.length === 0) return;
    const stillPending: typeof this.pendingDispatch = [];
    for (const item of this.pendingDispatch) {
      const agentForTask = this.selectAgentForTask(item.task);
      if (agentForTask) {
        item.task.assignedTo = agentForTask;
        const fullPrompt = item.contextPrompt
          ? `${item.task.description}\n\n${item.contextPrompt}`
          : item.task.description;
        const repoPath = this.delegationRouter.getTeamProjectDir() ?? undefined;
        if (repoPath) this.setupWorktreeForAgent(agentForTask, item.task.id, repoPath);
        const leadId = this.agentManager.getTeamLead();
        this.emitEvent({ type: "task:delegated", fromAgentId: leadId ?? "system", toAgentId: agentForTask, taskId: item.task.id, prompt: item.task.description });
        const targetSession = this.agentManager.get(agentForTask);
        if (targetSession) targetSession.runTask(item.task.id, fullPrompt, repoPath);
        console.log(`[Orchestrator] Dispatched queued task ${item.task.id} → ${agentForTask}`);
      } else {
        stillPending.push(item);
      }
    }
    this.pendingDispatch = stillPending;
  }

  private dispatchDecomposedTask(task: TaskNode, contextPrompt: string): void {
    // Find a matching agent by role
    const agentId = this.selectAgentForTask(task);
    if (!agentId) {
      // No idle agent — queue for later dispatch when an agent finishes
      console.log(`[Orchestrator] No idle agent for task ${task.id} (role: ${task.role}), queuing`);
      this.pendingDispatch.push({ task, contextPrompt });
      return;
    }

    task.assignedTo = agentId;

    // Build prompt: task description + decomposition context
    const fullPrompt = contextPrompt
      ? `${task.description}\n\n${contextPrompt}`
      : task.description;

    // Set up worktree
    const repoPath = this.delegationRouter.getTeamProjectDir() ?? undefined;
    if (repoPath) {
      this.setupWorktreeForAgent(agentId, task.id, repoPath);
    }

    const leadId = this.agentManager.getTeamLead();
    console.log(`[Orchestrator] Dispatching decomposed task ${task.id} → ${agentId} (${task.role})`);

    this.emitEvent({
      type: "task:delegated",
      fromAgentId: leadId ?? "system",
      toAgentId: agentId,
      taskId: task.id,
      prompt: task.description,
    });

    const session = this.agentManager.get(agentId);
    if (session) {
      session.runTask(task.id, fullPrompt, repoPath);
    }
  }

  private selectAgentForTask(task: TaskNode): string | null {
    // Only select from team members (filter by teamId matching the leader's team)
    const leadId = this.agentManager.getTeamLead();
    const leadSession = leadId ? this.agentManager.get(leadId) : null;
    const teamId = leadSession?.teamId;

    const candidates = this.agentManager.getAll()
      .filter(s => teamId ? s.teamId === teamId : true)  // restrict to same team
      .map(s => ({
        agentId: s.agentId,
        role: s.role ?? "",
        status: s.status,
        isTeamLead: this.agentManager.isTeamLead(s.agentId),
      }));
    return selectAgent(candidates, task.role ?? "Developer");
  }

  private queueAutoReview(devAgentId: string, taskId: string, result: TaskResultPayload): void {
    const session = this.agentManager.get(devAgentId);
    if (!session) return;

    // Get diff from worktree — compare agent branch against main (not HEAD, which is empty for committed changes)
    let diff = "";
    if (session.worktreePath && result.changedFiles.length > 0) {
      try {
        // Try merge-base diff first (shows what the agent actually changed vs main)
        diff = execFileSync("git", ["diff", "main...HEAD", "--", ...result.changedFiles], {
          cwd: session.worktreePath,
          encoding: "utf-8",
          timeout: 5000,
          maxBuffer: 200 * 1024,
        }).trim();
      } catch {
        // Fallback: try HEAD diff (works for uncommitted changes)
        try {
          diff = execFileSync("git", ["diff", "HEAD", "--", ...result.changedFiles], {
            cwd: session.worktreePath,
            encoding: "utf-8",
            timeout: 5000,
            maxBuffer: 200 * 1024,
          }).trim();
        } catch { /* no diff available */ }
      }
    }

    const prompt = buildReviewPrompt({
      changedFiles: result.changedFiles,
      summary: result.summary,
      entryFile: result.entryFile,
      diff,
      devName: session.name,
      devTaskId: taskId,
    });

    this.reviewQueue.push({ devAgentId, taskId, prompt });
    console.log(`[AutoReview] Queued review for ${session.name}'s task ${taskId} (queue: ${this.reviewQueue.length})`);
    this.processReviewQueue();
  }

  private processReviewQueue(): void {
    if (this.reviewerBusy || this.reviewQueue.length === 0) return;

    // Only select reviewer from the same team
    const leadId = this.agentManager.getTeamLead();
    const teamId = leadId ? this.agentManager.get(leadId)?.teamId : undefined;
    const reviewer = this.agentManager.getAll().find(
      s => (s.role ?? "").toLowerCase().includes("review")
        && !this.agentManager.isTeamLead(s.agentId)
        && (teamId ? s.teamId === teamId : true)
    );
    if (!reviewer || reviewer.status !== "idle") return;

    const next = this.reviewQueue.shift()!;
    this.reviewerBusy = true;
    const reviewTaskId = `auto-review-${next.taskId}`;

    console.log(`[AutoReview] Dispatching review of ${next.devAgentId}'s task to ${reviewer.name}`);

    this.emitEvent({
      type: "task:delegated",
      fromAgentId: "system",
      toAgentId: reviewer.agentId,
      taskId: reviewTaskId,
      prompt: `Review ${next.devAgentId}'s work`,
    });

    // Track mapping for routing FAIL back to the right dev
    this.delegationRouter.trackAutoReview(reviewTaskId, next.devAgentId);

    // Give reviewer the dev's worktree so they can read actual changed files
    const devSession = this.agentManager.get(next.devAgentId);
    const repoPath = devSession?.worktreePath
      ?? this.delegationRouter.getTeamProjectDir()
      ?? undefined;
    reviewer.runTask(reviewTaskId, next.prompt, repoPath);
  }

  private checkSchedulerCompletion(): void {
    if (!this.activeScheduler || !this.activePlan) return;
    if (!this.activeScheduler.isComplete()) return;

    // Wait for auto-review queue to drain before finalizing
    if (this.autoReview && (this.reviewQueue.length > 0 || this.reviewerBusy)) {
      console.log(`[Orchestrator] Scheduler done but reviews pending (queue: ${this.reviewQueue.length}, busy: ${this.reviewerBusy})`);
      return;
    }

    // Wait for any worker still running (e.g., dev fixing after VERDICT:FAIL)
    const leadId_ = this.agentManager.getTeamLead();
    const hasWorkingWorkers = this.agentManager.getAll().some(w =>
      w.agentId !== leadId_ && w.status === "working"
    );
    if (hasWorkingWorkers) {
      console.log(`[Orchestrator] Scheduler done but workers still running, deferring finalization`);
      return;
    }

    const plan = this.activePlan;
    const allDone = plan.tree.children.every(c => c.status === "done");
    const results = plan.tree.children
      .filter(c => c.result)
      .map(c => `[${c.id}] ${c.result}`)
      .join("\n");

    console.log(`[Orchestrator] Decomposition plan ${allDone ? "completed" : "finished with failures"}: ${plan.tree.children.length} tasks`);

    // Emit as final team result
    const leadId = this.agentManager.getTeamLead();
    if (leadId && !this.teamFinalized) {
      this.teamFinalized = true;

      // execute → complete transition
      const completeInfo = this.phaseMachine.checkFinalResult(leadId);
      if (completeInfo) {
        this.emitEvent({ type: "team:phase", teamId: completeInfo.teamId, phase: completeInfo.phase, leadAgentId: completeInfo.leadAgentId });
      }

      // Merge all worker worktrees back to main branch
      if (this.worktreeMerge) {
        this.mergeAllWorkerWorktrees(leadId);
      }

      const result: TaskResultPayload = {
        summary: allDone
          ? `All ${plan.tree.children.length} tasks completed.\n${results}`
          : `Plan completed with failures.\n${results}`,
        changedFiles: [...this.teamChangedFiles],
        diffStat: "",
        testResult: allDone ? "passed" : "failed",
      };

      // Finalize: merge team data, validate entry file, resolve preview URL
      finalizeTeamResult({
        result,
        teamPreview: this.teamPreview,
        teamChangedFiles: this.teamChangedFiles,
        projectDir: this.delegationRouter.getTeamProjectDir(),
        workspace: this.workspace,
        detectWorkerPreview: () => {
          for (const worker of this.agentManager.getAll()) {
            if (worker.agentId === leadId) continue;
            const { previewUrl, previewPath } = worker.detectPreview();
            if (previewUrl) return { previewUrl, previewPath };
          }
          return null;
        },
      });

      this.emitEvent({
        type: "task:done",
        agentId: leadId,
        taskId: plan.id,
        result,
        isFinalResult: true,
      });
    }

    this.activePlan = null;
    this.activeScheduler = null;
  }

  private emitEvent(event: OrchestratorEvent): void {
    this.emit(event.type, event as never);
  }
}
