export { Orchestrator } from "./orchestrator.js";
export { AgentSession, setSessionDir } from "./agent-session.js";
export { previewServer } from "./preview-server.js";
export { AgentManager } from "./agent-manager.js";
export { DelegationRouter } from "./delegation.js";
export { PhaseMachine } from "./phase-machine.js";
export { finalizeTeamResult } from "./result-finalizer.js";
export type { TeamPreview, FinalizeContext } from "./result-finalizer.js";
export { PromptEngine } from "./prompt-templates.js";
export { resolvePreview } from "./preview-resolver.js";
export type { TemplateName } from "./prompt-templates.js";
export type { PreviewInput, PreviewResult } from "./preview-resolver.js";
export { ReactionEngine, DEFAULT_RULES } from "./reaction/index.js";
export type { ReactionTrigger, ReactionAction, ReactionRule, ReactionMatch, ReactionContext, ReactionEngineConfig, AgentSessionFacade, OrchestratorFacade } from "./reaction/index.js";
export { parseAgentOutput } from "./output-parser.js";
export type { ParsedResult } from "./output-parser.js";
export { CONFIG } from "./config.js";
export { getMemoryContext, getMemoryStore, clearMemory, recordReviewFeedback, recordProjectCompletion, recordProjectRatings, recordTechPreference, commitSession, buildRecoveryContext, getRecoveryString, getAgentL0, getWorkState, updateWorkState, clearAgentWorkState, setStorageRoot } from "./memory.js";
export type { ReviewPattern, ProjectRecord } from "./memory.js";
export { createWorktree, getManagedWorktreeBranch, getMergeHistory, mergeWorktree, removeWorktree, removeWorktreeOnly, checkConflicts, cleanupStaleWorktrees, getIsolatedGitEnv, getWorktreeBaseDir, resolveGitWorkspaceRoot } from "./worktree.js";
export { WorktreeWorkspace } from "./workspace/index.js";
export type { Workspace, WorkspaceInfo, WorkspaceCreateConfig, WorkspaceMergeResult, PostCreateConfig } from "./workspace/index.js";
export type { CleanupWorktreeOptions, MergeResult, RuntimeOwnerInfo, WorktreeOwnerInfo } from "./worktree.js";
export type { AIBackend, BuildArgsOpts, BackendStability, GuardType } from "./ai-backend.js";
export type { AgentPlugin, ActivityState, AgentSessionRef, AgentSessionInfo, WorkspaceHooksConfig } from "./agent/index.js";
export { createWebSocketNotifier } from "./notifier/index.js";
export type { Notifier, OrchestratorNotification, OrchestratorNotification as Notification, NotificationPriority } from "./notifier/index.js";
export { createPluginRegistry } from "./plugin-registry.js";
export type { PluginRegistry, PluginSlot, PluginManifest } from "./plugin-registry.js";
export { syncAgentDefs } from "./agent-defs.js";
export { TaskScheduler, tryParseDecomposition, parseDecompositionBlock, formatLineage, formatSiblings, DEFAULT_DECOMPOSER_CONFIG } from "./decomposer/index.js";
export type { TaskNode, DecompositionPlan, DecompositionBlock, DecomposerConfig, TaskKind, TaskStatus } from "./decomposer/index.js";
export type { TeamPhaseInfo } from "./phase-machine.js";
export type {
  AgentStatus,
  RiskLevel,
  Decision,
  TeamPhase,
  TaskResultPayload,
  OrchestratorEvent,
  OrchestratorEventMap,
  OrchestratorOptions,
  CreateAgentOpts,
  CreateTeamOpts,
  RunTaskOpts,
  WorktreeOptions,
  RetryOptions,
  TaskStartedEvent,
  TaskDoneEvent,
  TaskFailedEvent,
  TaskDelegatedEvent,
  TaskRetryingEvent,
  AgentStatusEvent,
  ApprovalNeededEvent,
  LogAppendEvent,
  LogActivityEvent,
  TeamChatEvent,
  TaskQueuedEvent,
  WorktreeCreatedEvent,
  WorktreeMergedEvent,
  AgentActivityEvent,
  AgentCreatedEvent,
  AgentFiredEvent,
  TaskResultReturnedEvent,
  TeamPhaseChangedEvent,
} from "./types.js";

import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorOptions } from "./types.js";

/**
 * Factory function to create an Orchestrator instance.
 */
export function createOrchestrator(options: OrchestratorOptions): Orchestrator {
  return new Orchestrator(options);
}
