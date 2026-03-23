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
  teamId: z.string().optional(),
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
  teamId: z.string().optional(),
  workDir: z.string().optional(),
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
  leadId: z.string(),
  memberIds: z.array(z.string()),
  backends: z.record(z.string(), z.string()).optional(),
  workDir: z.string().optional(),
});

export const ServePreviewCommand = z.object({
  type: z.literal("SERVE_PREVIEW"),
  filePath: z.string().optional(),
  previewCmd: z.string().optional(),
  previewPort: z.number().optional(),
  cwd: z.string().optional(),
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

export const ApprovePlanCommand = z.object({
  type: z.literal("APPROVE_PLAN"),
  agentId: z.string(),
});

export const EndProjectCommand = z.object({
  type: z.literal("END_PROJECT"),
  agentId: z.string(),
  name: z.string().optional(),
  role: z.string().optional(),
  personality: z.string().optional(),
  backend: z.string().optional(),
});

export const SaveAgentDefCommand = z.object({
  type: z.literal("SAVE_AGENT_DEF"),
  agent: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    skills: z.string(),
    personality: z.string(),
    palette: z.number(),
    isBuiltin: z.boolean(),
    teamRole: z.enum(["dev", "reviewer", "leader"]),
  }),
});

export const DeleteAgentDefCommand = z.object({
  type: z.literal("DELETE_AGENT_DEF"),
  agentDefId: z.string(),
});

export const PickFolderCommand = z.object({
  type: z.literal("PICK_FOLDER"),
  requestId: z.string(),
});

export const UploadImageCommand = z.object({
  type: z.literal("UPLOAD_IMAGE"),
  requestId: z.string(),
  /** base64-encoded image data (without data: prefix) */
  data: z.string(),
  /** Original filename or generated name */
  filename: z.string(),
});

export const SuggestCommand = z.object({
  type: z.literal("SUGGEST"),
  text: z.string().max(500),
  author: z.string().max(30).optional(),
});

export const RateProjectCommand = z.object({
  type: z.literal("RATE_PROJECT"),
  projectId: z.string().optional(),
  ratings: z.record(z.string(), z.number().min(1).max(5)),
});

export const ListProjectsCommand = z.object({
  type: z.literal("LIST_PROJECTS"),
});

export const LoadProjectCommand = z.object({
  type: z.literal("LOAD_PROJECT"),
  projectId: z.string(),
});

export const UpdateAgencyAgentsCommand = z.object({
  type: z.literal("UPDATE_AGENCY_AGENTS"),
});

export const GetConfigCommand = z.object({
  type: z.literal("GET_CONFIG"),
});

export const SaveConfigCommand = z.object({
  type: z.literal("SAVE_CONFIG"),
  telegramBotToken: z.string().optional(),
  telegramAllowedUsers: z.array(z.string()).optional(),
  worktreeEnabled: z.boolean().optional(),
  tunnelToken: z.string().optional(),
  tunnelBaseUrl: z.string().optional(),
});

export const MergeWorktreeCommand = z.object({
  type: z.literal("MERGE_WORKTREE"),
  agentId: z.string(),
});

export const UndoMergeCommand = z.object({
  type: z.literal("UNDO_MERGE"),
  agentId: z.string(),
});

export const RevertWorktreeCommand = z.object({
  type: z.literal("REVERT_WORKTREE"),
  agentId: z.string(),
});

export const ToggleAutoMergeCommand = z.object({
  type: z.literal("TOGGLE_AUTO_MERGE"),
  agentId: z.string(),
  autoMerge: z.boolean(),
});

export const RequestReviewCommand = z.object({
  type: z.literal("REQUEST_REVIEW"),
  /** Frontend-generated reviewer agent ID (so frontend can set up overlay immediately) */
  reviewerAgentId: z.string(),
  sourceAgentId: z.string(),
  changedFiles: z.array(z.string()),
  projectDir: z.string().optional(),
  entryFile: z.string().optional(),
  summary: z.string().optional(),
  backend: z.string().optional(),
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
  ApprovePlanCommand,
  EndProjectCommand,
  SaveAgentDefCommand,
  DeleteAgentDefCommand,
  PickFolderCommand,
  UploadImageCommand,
  SuggestCommand,
  RateProjectCommand,
  ListProjectsCommand,
  LoadProjectCommand,
  UpdateAgencyAgentsCommand,
  RequestReviewCommand,
  MergeWorktreeCommand,
  UndoMergeCommand,
  RevertWorktreeCommand,
  ToggleAutoMergeCommand,
  GetConfigCommand,
  SaveConfigCommand,
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
export type ApprovePlanCommand = z.infer<typeof ApprovePlanCommand>;
export type EndProjectCommand = z.infer<typeof EndProjectCommand>;
export type SaveAgentDefCommand = z.infer<typeof SaveAgentDefCommand>;
export type DeleteAgentDefCommand = z.infer<typeof DeleteAgentDefCommand>;
export type PickFolderCommand = z.infer<typeof PickFolderCommand>;
export type UploadImageCommand = z.infer<typeof UploadImageCommand>;
export type SuggestCommand = z.infer<typeof SuggestCommand>;
export type RateProjectCommand = z.infer<typeof RateProjectCommand>;
export type ListProjectsCommand = z.infer<typeof ListProjectsCommand>;
export type LoadProjectCommand = z.infer<typeof LoadProjectCommand>;
export type UpdateAgencyAgentsCommand = z.infer<typeof UpdateAgencyAgentsCommand>;
export type RequestReviewCommand = z.infer<typeof RequestReviewCommand>;
export type GetConfigCommand = z.infer<typeof GetConfigCommand>;
export type MergeWorktreeCommand = z.infer<typeof MergeWorktreeCommand>;
export type UndoMergeCommand = z.infer<typeof UndoMergeCommand>;
export type RevertWorktreeCommand = z.infer<typeof RevertWorktreeCommand>;
export type ToggleAutoMergeCommand = z.infer<typeof ToggleAutoMergeCommand>;
export type SaveConfigCommand = z.infer<typeof SaveConfigCommand>;
export type Command = z.infer<typeof CommandSchema>;
