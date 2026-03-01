import { z } from "zod";
import { AgentStatusEnum, RiskLevelEnum } from "./types";

export const AgentStatusEvent = z.object({
  type: z.literal("AGENT_STATUS"),
  agentId: z.string(),
  status: AgentStatusEnum,
  details: z.string().optional(),
});

export const TaskStartedEvent = z.object({
  type: z.literal("TASK_STARTED"),
  agentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
});

export const LogAppendEvent = z.object({
  type: z.literal("LOG_APPEND"),
  agentId: z.string(),
  taskId: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  chunk: z.string(),
});

export const ApprovalNeededEvent = z.object({
  type: z.literal("APPROVAL_NEEDED"),
  approvalId: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  riskLevel: RiskLevelEnum,
});

export const TaskResultPayload = z.object({
  summary: z.string(),
  fullOutput: z.string().optional(),
  changedFiles: z.array(z.string()),
  diffStat: z.string(),
  testResult: z.enum(["passed", "failed", "unknown"]),
  nextSuggestion: z.string().optional(),
  previewUrl: z.string().optional(),
  previewPath: z.string().optional(),
});

export const TaskDoneEvent = z.object({
  type: z.literal("TASK_DONE"),
  agentId: z.string(),
  taskId: z.string(),
  result: TaskResultPayload,
  isFinalResult: z.boolean().optional(),
});

export const TaskFailedEvent = z.object({
  type: z.literal("TASK_FAILED"),
  agentId: z.string(),
  taskId: z.string(),
  error: z.string(),
});

export const TaskDelegatedEvent = z.object({
  type: z.literal("TASK_DELEGATED"),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
});

export const AgentCreatedEvent = z.object({
  type: z.literal("AGENT_CREATED"),
  agentId: z.string(),
  name: z.string(),
  role: z.string(),
  palette: z.number().optional(),
  personality: z.string().optional(),
  backend: z.string().optional(),
  isTeamLead: z.boolean().optional(),
  teamId: z.string().optional(),
  isExternal: z.boolean().optional(),
  pid: z.number().optional(),
  cwd: z.string().optional(),
  startedAt: z.number().optional(),
});

export const AgentFiredEvent = z.object({
  type: z.literal("AGENT_FIRED"),
  agentId: z.string(),
});

export const TaskResultReturnedEvent = z.object({
  type: z.literal("TASK_RESULT_RETURNED"),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  taskId: z.string(),
  summary: z.string(),
  success: z.boolean(),
});

export const TeamChatEvent = z.object({
  type: z.literal("TEAM_CHAT"),
  fromAgentId: z.string(),
  toAgentId: z.string().optional(),
  message: z.string(),
  messageType: z.enum(["delegation", "result", "status"]),
  taskId: z.string().optional(),
  timestamp: z.number(),
});

export const TaskQueuedEvent = z.object({
  type: z.literal("TASK_QUEUED"),
  agentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
  position: z.number(),
});

export const GatewayEventSchema = z.discriminatedUnion("type", [
  AgentStatusEvent,
  TaskStartedEvent,
  LogAppendEvent,
  ApprovalNeededEvent,
  TaskDoneEvent,
  TaskFailedEvent,
  TaskDelegatedEvent,
  AgentCreatedEvent,
  AgentFiredEvent,
  TaskResultReturnedEvent,
  TeamChatEvent,
  TaskQueuedEvent,
]);

export type AgentStatusEvent = z.infer<typeof AgentStatusEvent>;
export type TaskStartedEvent = z.infer<typeof TaskStartedEvent>;
export type LogAppendEvent = z.infer<typeof LogAppendEvent>;
export type ApprovalNeededEvent = z.infer<typeof ApprovalNeededEvent>;
export type TaskResultPayload = z.infer<typeof TaskResultPayload>;
export type TaskDoneEvent = z.infer<typeof TaskDoneEvent>;
export type TaskFailedEvent = z.infer<typeof TaskFailedEvent>;
export type TaskDelegatedEvent = z.infer<typeof TaskDelegatedEvent>;
export type AgentCreatedEvent = z.infer<typeof AgentCreatedEvent>;
export type AgentFiredEvent = z.infer<typeof AgentFiredEvent>;
export type TaskResultReturnedEvent = z.infer<typeof TaskResultReturnedEvent>;
export type TeamChatEvent = z.infer<typeof TeamChatEvent>;
export type TaskQueuedEvent = z.infer<typeof TaskQueuedEvent>;
export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
