// ---------------------------------------------------------------------------
// Agent status (local definition — no dependency on @office/shared)
// ---------------------------------------------------------------------------

export type AgentStatus = "idle" | "working" | "waiting_approval" | "done" | "error";
export type RiskLevel = "low" | "med" | "high";
export type Decision = "yes" | "no";

// ---------------------------------------------------------------------------
// Task result
// ---------------------------------------------------------------------------

export interface TaskResultPayload {
  summary: string;
  fullOutput?: string;
  changedFiles: string[];
  diffStat: string;
  testResult: "passed" | "failed" | "unknown";
  previewUrl?: string;
  previewPath?: string;
  entryFile?: string;
  projectDir?: string;
  previewCmd?: string;
  previewPort?: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Orchestrator events
// ---------------------------------------------------------------------------

export interface TaskStartedEvent {
  type: "task:started";
  agentId: string;
  taskId: string;
  prompt: string;
}

export interface TaskDoneEvent {
  type: "task:done";
  agentId: string;
  taskId: string;
  result: TaskResultPayload;
  /** True when a team leader completes with no pending delegated tasks — the real final result. */
  isFinalResult?: boolean;
}

export interface TaskFailedEvent {
  type: "task:failed";
  agentId: string;
  taskId: string;
  error: string;
}

export interface TaskDelegatedEvent {
  type: "task:delegated";
  fromAgentId: string;
  toAgentId: string;
  taskId: string;
  prompt: string;
}

export interface TaskRetryingEvent {
  type: "task:retrying";
  agentId: string;
  taskId: string;
  attempt: number;
  maxRetries: number;
  error: string;
}

export interface AgentStatusEvent {
  type: "agent:status";
  agentId: string;
  status: AgentStatus;
}

export interface ApprovalNeededEvent {
  type: "approval:needed";
  approvalId: string;
  agentId: string;
  taskId: string;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
}

export interface LogAppendEvent {
  type: "log:append";
  agentId: string;
  taskId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface LogActivityEvent {
  type: "log:activity";
  agentId: string;
  taskId: string;
  text: string;
}

export interface TeamChatEvent {
  type: "team:chat";
  fromAgentId: string;
  toAgentId?: string;
  message: string;
  messageType: "delegation" | "result" | "status";
  taskId?: string;
  timestamp: number;
}

export interface TaskQueuedEvent {
  type: "task:queued";
  agentId: string;
  taskId: string;
  prompt: string;
  position: number;
}

export interface AgentActivityEvent {
  type: "agent:activity";
  agentId: string;
  agentName: string;
  intent: string;
  phase: "started" | "completed";
  touchedFiles?: string[];
  exports?: string[];
  needs?: string[];
}

export interface AgentCreatedEvent {
  type: "agent:created";
  agentId: string;
  name: string;
  role: string;
  palette?: number;
  personality?: string;
  backend?: string;
  isTeamLead?: boolean;
  teamId?: string;
}

export interface AgentFiredEvent {
  type: "agent:fired";
  agentId: string;
}

export interface TaskResultReturnedEvent {
  type: "task:result-returned";
  fromAgentId: string;
  toAgentId: string;
  taskId: string;
  summary: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Team phase
// ---------------------------------------------------------------------------

export type TeamPhase = "create" | "design" | "execute" | "complete";

export interface TeamPhaseChangedEvent {
  type: "team:phase";
  teamId: string;
  phase: TeamPhase;
  leadAgentId: string;
}

export interface TokenUpdateEvent {
  type: "token:update";
  agentId: string;
  inputTokens: number;
  outputTokens: number;
}

export type OrchestratorEvent =
  | TaskStartedEvent
  | TaskDoneEvent
  | TaskFailedEvent
  | TaskDelegatedEvent
  | TaskRetryingEvent
  | AgentStatusEvent
  | ApprovalNeededEvent
  | LogAppendEvent
  | LogActivityEvent
  | TeamChatEvent
  | TaskQueuedEvent
  | AgentActivityEvent
  | AgentCreatedEvent
  | AgentFiredEvent
  | TaskResultReturnedEvent
  | TeamPhaseChangedEvent
  | TokenUpdateEvent;

// ---------------------------------------------------------------------------
// Event map for typed EventEmitter
// ---------------------------------------------------------------------------

export interface OrchestratorEventMap {
  "task:started": [TaskStartedEvent];
  "task:done": [TaskDoneEvent];
  "task:failed": [TaskFailedEvent];
  "task:delegated": [TaskDelegatedEvent];
  "task:retrying": [TaskRetryingEvent];
  "agent:status": [AgentStatusEvent];
  "approval:needed": [ApprovalNeededEvent];
  "log:append": [LogAppendEvent];
  "log:activity": [LogActivityEvent];
  "team:chat": [TeamChatEvent];
  "task:queued": [TaskQueuedEvent];
  "agent:activity": [AgentActivityEvent];
  "agent:created": [AgentCreatedEvent];
  "agent:fired": [AgentFiredEvent];
  "task:result-returned": [TaskResultReturnedEvent];
  "team:phase": [TeamPhaseChangedEvent];
  "token:update": [TokenUpdateEvent];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum retries per task (default: 2) */
  maxRetries?: number;
  /** Escalate to team lead after exhausting retries (default: true) */
  escalateToLeader?: boolean;
}

export interface OrchestratorOptions {
  /** Root workspace directory */
  workspace: string;
  /** Registered AI backends */
  backends: import("./ai-backend.js").AIBackend[];
  /** Default backend ID (defaults to first backend) */
  defaultBackend?: string;
  /** Auto-retry options. false to disable entirely. */
  retry?: RetryOptions | false;
  /** FS directory for prompt template overrides */
  promptsDir?: string;
  /** Sandbox mode: "full" gives agent full access, "safe" restricts */
  sandboxMode?: "full" | "safe";
}

export interface CreateAgentOpts {
  agentId: string;
  name: string;
  role: string;
  personality?: string;
  backend?: string;
  palette?: number;
  resumeHistory?: boolean;
  teamId?: string;
  /** Agent-specific working directory (overrides orchestrator-level workspace) */
  workDir?: string;
}

export interface CreateTeamOpts {
  leadPresetIndex: number;
  memberPresets: Array<{ name: string; role: string; personality?: string; palette?: number }>;
  backends?: Record<string, string>;
}

export interface RunTaskOpts {
  repoPath?: string;
  phaseOverride?: string;
}
