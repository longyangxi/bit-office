// packages/orchestrator/src/workspace/types.ts

/**
 * Workspace plugin interface — abstraction over git worktree isolation.
 * Default implementation: WorktreeWorkspace (wraps existing worktree.ts).
 */

// Re-export existing types that consumers need
export type { WorktreeOwnerInfo, CleanupWorktreeOptions, RuntimeOwnerInfo } from "../worktree.js";

export interface WorkspaceInfo {
  path: string;
  branch: string;
  agentId: string;
}

/** Input config for creating a workspace */
export interface WorkspaceCreateConfig {
  /** Main repository root directory */
  repoRoot: string;
  agentId: string;
  agentName: string;
  /** Partial owner info — agentId/branch/repoRoot are derived during creation */
  owner?: {
    gatewayId: string;
    machineId: string;
    instanceDir: string;
    pid: number;
    startedAt: number;
  };
}

export interface WorkspaceMergeResult {
  success: boolean;
  commitHash?: string;
  commitMessage?: string;
  conflictFiles?: string[];
  stagedFiles?: string[];
}

export interface RevertResult {
  success: boolean;
  commitId?: string;
  message?: string;
  commitsAhead: number;
}

export interface PostCreateConfig {
  /** Relative paths to symlink from main repo into workspace */
  symlinks?: string[];
  /** Shell commands to run after workspace creation */
  commands?: string[];
}

/**
 * All methods that operate on an existing workspace take two path params:
 * - repoRoot: the main repository root (where main branch lives)
 * - worktreePath: the agent's workspace directory
 * This matches the existing function signatures in worktree.ts.
 */
export interface Workspace {
  readonly name: string;

  create(config: WorkspaceCreateConfig): WorkspaceInfo | null;

  destroy(repoRoot: string, worktreePath: string, branch: string): void;

  sync(repoRoot: string, worktreePath: string): void;

  merge(
    repoRoot: string,
    worktreePath: string,
    branch: string,
    opts?: {
      keepAlive?: boolean;
      summary?: string;
      agentName?: string;
      agentId?: string;
    },
  ): WorkspaceMergeResult;

  revert(repoRoot: string, worktreePath: string): RevertResult;

  undoMerge(repoRoot: string, commitHash: string): { success: boolean; message?: string; method?: "reset" | "revert" };

  hasPendingChanges(repoRoot: string, worktreePath: string): boolean;

  checkConflicts(repoRoot: string, branch: string): string[];

  cleanup(
    repoRoot: string,
    activeBranches: Set<string>,
    options?: import("../worktree.js").CleanupWorktreeOptions,
  ): { removedBranches: string[]; removedWorktrees: string[] };

  /** Optional: run post-creation hooks (symlinks, commands) */
  postCreate?(info: WorkspaceInfo, repoRoot: string, config: PostCreateConfig): Promise<void>;
}
