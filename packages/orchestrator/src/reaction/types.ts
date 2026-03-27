// packages/orchestrator/src/reaction/types.ts

export type { Notification } from "../notifier/types.js";

// ── Triggers ──
export type ReactionTrigger =
  | "task:failed"
  | "review:fail"
  | "agent:stuck"
  | "agent:error"
  | "delegation:budget"
  | "task:done";

// ── Actions ──
export type ReactionAction =
  | "retry"
  | "send-to-agent"
  | "escalate-to-leader"
  | "notify"
  | "force-finalize";

// ── Facades (restricted access for the engine) ──
export interface AgentSessionFacade {
  prependTask(taskId: string, prompt: string): void;
  getAgentId(): string;
  getRole(): string;
}

export interface OrchestratorFacade {
  getTeamLead(): AgentSessionFacade | null;
  runTask(agentId: string, taskId: string, prompt: string): void;
  forceFinalize(agentId: string): void;
  emitNotification(notification: Notification): void;
}

// ── Context passed with every event ──
export interface ReactionContext {
  agentId: string;
  taskId: string;
  error?: string;
  role?: string;
  wasTimeout?: boolean;
  wasCancellation?: boolean;
  isDelegated?: boolean;
  isReviewer?: boolean;
  reviewerOutput?: string;
  devAgentId?: string;
  originalPrompt?: string;
  session: AgentSessionFacade;
  orchestrator: OrchestratorFacade;
}

// ── Rules ──
export interface ReactionMatch {
  role?: string;
  attempt?: { gte?: number };
  wasTimeout?: boolean;
  isDelegated?: boolean;
}

export interface ReactionRule {
  trigger: ReactionTrigger;
  match?: ReactionMatch;
  action: ReactionAction;
  retries?: number;
  escalateAction?: ReactionAction;
  thresholdMs?: number;
}

export interface ReactionEngineConfig {
  rules: ReactionRule[];
}
