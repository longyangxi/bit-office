import { z } from "zod";
import { AgentStatusEnum, RiskLevelEnum, TeamPhaseEnum } from "./types";

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

export const TokenUsage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
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
  entryFile: z.string().optional(),
  projectDir: z.string().optional(),
  previewCmd: z.string().optional(),
  previewPort: z.number().optional(),
  tokenUsage: TokenUsage.optional(),
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
  workDir: z.string().optional(),
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

export const TokenUpdateEvent = z.object({
  type: z.literal("TOKEN_UPDATE"),
  agentId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const ToolActivityEvent = z.object({
  type: z.literal("TOOL_ACTIVITY"),
  agentId: z.string(),
  text: z.string(),
});

export const TeamPhaseEvent = z.object({
  type: z.literal("TEAM_PHASE"),
  teamId: z.string(),
  phase: TeamPhaseEnum,
  leadAgentId: z.string(),
});

export const SuggestionEvent = z.object({
  type: z.literal("SUGGESTION"),
  text: z.string(),
  author: z.string(),
  timestamp: z.number(),
});

export const AgentDefsEvent = z.object({
  type: z.literal("AGENT_DEFS"),
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    skills: z.string(),
    personality: z.string(),
    palette: z.number(),
    isBuiltin: z.boolean(),
    teamRole: z.enum(["dev", "reviewer", "leader"]),
  })),
});

export const AgentsSyncEvent = z.object({
  type: z.literal("AGENTS_SYNC"),
  agentIds: z.array(z.string()),
});

const ProjectPreviewSchema = z.object({
  entryFile: z.string().optional(),
  projectDir: z.string().optional(),
  previewCmd: z.string().optional(),
  previewPort: z.number().optional(),
}).optional();

export const ProjectListEvent = z.object({
  type: z.literal("PROJECT_LIST"),
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    startedAt: z.number(),
    endedAt: z.number(),
    agentNames: z.array(z.string()),
    eventCount: z.number(),
    preview: ProjectPreviewSchema,
    tokenUsage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    ratings: z.record(z.string(), z.number()).optional(),
  })),
});

export const ProjectDataEvent = z.object({
  type: z.literal("PROJECT_DATA"),
  projectId: z.string(),
  name: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  events: z.array(z.any()),
});

export const PreviewReadyEvent = z.object({
  type: z.literal("PREVIEW_READY"),
  url: z.string(),
});

export const FolderPickedEvent = z.object({
  type: z.literal("FOLDER_PICKED"),
  requestId: z.string(),
  path: z.string(),
});

export const ImageUploadedEvent = z.object({
  type: z.literal("IMAGE_UPLOADED"),
  requestId: z.string(),
  path: z.string(),
});

export const AgencyAgentsUpdatedEvent = z.object({
  type: z.literal("AGENCY_AGENTS_UPDATED"),
  success: z.boolean(),
  message: z.string(),
  count: z.number().optional(),
});

export const BackendsAvailableEvent = z.object({
  type: z.literal("BACKENDS_AVAILABLE"),
  backends: z.array(z.string()),
});

export const ConfigLoadedEvent = z.object({
  type: z.literal("CONFIG_LOADED"),
  telegramBotToken: z.string().optional(),
  telegramAllowedUsers: z.array(z.string()).optional(),
  telegramConnected: z.boolean().optional(),
});

export const ConfigSavedEvent = z.object({
  type: z.literal("CONFIG_SAVED"),
  success: z.boolean(),
  message: z.string(),
  telegramConnected: z.boolean().optional(),
});

export const GatewayEventSchema = z.discriminatedUnion("type", [
  AgentsSyncEvent,
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
  TokenUpdateEvent,
  ToolActivityEvent,
  TeamPhaseEvent,
  AgentDefsEvent,
  SuggestionEvent,
  ProjectListEvent,
  ProjectDataEvent,
  PreviewReadyEvent,
  FolderPickedEvent,
  ImageUploadedEvent,
  AgencyAgentsUpdatedEvent,
  BackendsAvailableEvent,
  ConfigLoadedEvent,
  ConfigSavedEvent,
]);

export type TokenUsage = z.infer<typeof TokenUsage>;
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
export type TokenUpdateEvent = z.infer<typeof TokenUpdateEvent>;
export type ToolActivityEvent = z.infer<typeof ToolActivityEvent>;
export type TeamPhaseEvent = z.infer<typeof TeamPhaseEvent>;
export type AgentDefsEvent = z.infer<typeof AgentDefsEvent>;
export type SuggestionEvent = z.infer<typeof SuggestionEvent>;
export type AgentsSyncEvent = z.infer<typeof AgentsSyncEvent>;
export type ProjectListEvent = z.infer<typeof ProjectListEvent>;
export type ProjectDataEvent = z.infer<typeof ProjectDataEvent>;
export type PreviewReadyEvent = z.infer<typeof PreviewReadyEvent>;
export type FolderPickedEvent = z.infer<typeof FolderPickedEvent>;
export type ImageUploadedEvent = z.infer<typeof ImageUploadedEvent>;
export type AgencyAgentsUpdatedEvent = z.infer<typeof AgencyAgentsUpdatedEvent>;
export type BackendsAvailableEvent = z.infer<typeof BackendsAvailableEvent>;
export type ConfigLoadedEvent = z.infer<typeof ConfigLoadedEvent>;
export type ConfigSavedEvent = z.infer<typeof ConfigSavedEvent>;
export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
