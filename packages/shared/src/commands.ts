import { z } from "zod";
import { DecisionEnum } from "./types";

export const RunTaskCommand = z.object({
  type: z.literal("RUN_TASK"),
  agentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
  repoPath: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  personality: z.string().optional(),
  backend: z.string().optional(),
});

export const ApprovalDecisionCommand = z.object({
  type: z.literal("APPROVAL_DECISION"),
  approvalId: z.string(),
  decision: DecisionEnum,
});

export const CancelTaskCommand = z.object({
  type: z.literal("CANCEL_TASK"),
  agentId: z.string(),
  taskId: z.string(),
});

export const PingCommand = z.object({
  type: z.literal("PING"),
});

export const CreateAgentCommand = z.object({
  type: z.literal("CREATE_AGENT"),
  agentId: z.string(),
  name: z.string(),
  role: z.string(),
  palette: z.number().optional(),
  personality: z.string().optional(),
  backend: z.string().optional(),
});

export const FireAgentCommand = z.object({
  type: z.literal("FIRE_AGENT"),
  agentId: z.string(),
});

export const OpenFileCommand = z.object({
  type: z.literal("OPEN_FILE"),
  path: z.string(),
});

export const CreateTeamCommand = z.object({
  type: z.literal("CREATE_TEAM"),
  leadPresetIndex: z.number(),
  memberPresetIndices: z.array(z.number()),
  backends: z.record(z.string(), z.string()).optional(),
});

export const ServePreviewCommand = z.object({
  type: z.literal("SERVE_PREVIEW"),
  filePath: z.string(),
});

export const StopTeamCommand = z.object({
  type: z.literal("STOP_TEAM"),
});

export const FireTeamCommand = z.object({
  type: z.literal("FIRE_TEAM"),
});

export const KillExternalCommand = z.object({
  type: z.literal("KILL_EXTERNAL"),
  agentId: z.string(),
});

export const CommandSchema = z.discriminatedUnion("type", [
  RunTaskCommand,
  ApprovalDecisionCommand,
  CancelTaskCommand,
  PingCommand,
  CreateAgentCommand,
  FireAgentCommand,
  OpenFileCommand,
  CreateTeamCommand,
  ServePreviewCommand,
  StopTeamCommand,
  FireTeamCommand,
  KillExternalCommand,
]);

export type RunTaskCommand = z.infer<typeof RunTaskCommand>;
export type ApprovalDecisionCommand = z.infer<typeof ApprovalDecisionCommand>;
export type CancelTaskCommand = z.infer<typeof CancelTaskCommand>;
export type PingCommand = z.infer<typeof PingCommand>;
export type CreateAgentCommand = z.infer<typeof CreateAgentCommand>;
export type FireAgentCommand = z.infer<typeof FireAgentCommand>;
export type OpenFileCommand = z.infer<typeof OpenFileCommand>;
export type CreateTeamCommand = z.infer<typeof CreateTeamCommand>;
export type ServePreviewCommand = z.infer<typeof ServePreviewCommand>;
export type StopTeamCommand = z.infer<typeof StopTeamCommand>;
export type FireTeamCommand = z.infer<typeof FireTeamCommand>;
export type KillExternalCommand = z.infer<typeof KillExternalCommand>;
export type Command = z.infer<typeof CommandSchema>;
