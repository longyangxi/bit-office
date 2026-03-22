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
export { RetryTracker } from "./retry.js";
export { parseAgentOutput } from "./output-parser.js";
export type { ParsedResult } from "./output-parser.js";
export { CONFIG } from "./config.js";
export { getMemoryContext, getMemoryStore, clearMemory, recordReviewFeedback, recordProjectCompletion, recordProjectRatings, recordTechPreference, commitSession, buildRecoveryContext, getRecoveryString, getAgentL0, getWorkState, updateWorkState, clearAgentWorkState, setStorageRoot } from "./memory.js";
export type { ReviewPattern, ProjectRecord } from "./memory.js";
export { createWorktree, getManagedWorktreeBranch, mergeWorktree, removeWorktree, removeWorktreeOnly, checkConflicts, cleanupStaleWorktrees, getIsolatedGitEnv, getWorktreeBaseDir, resolveGitWorkspaceRoot } from "./worktree.js";
export type { CleanupWorktreeOptions, MergeResult, RuntimeOwnerInfo, WorktreeOwnerInfo } from "./worktree.js";
export type { AIBackend, BuildArgsOpts, BackendStability, GuardType } from "./ai-backend.js";
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
