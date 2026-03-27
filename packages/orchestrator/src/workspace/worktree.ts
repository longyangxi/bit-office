import type {
  Workspace,
  WorkspaceCreateConfig,
  WorkspaceInfo,
  WorkspaceMergeResult,
  PostCreateConfig,
  CleanupWorktreeOptions,
} from "./types.js";
import type { RevertResult as WorktreeRevertResult } from "../worktree.js";
import {
  createWorktree as _createWorktree,
  mergeWorktree as _mergeWorktree,
  removeWorktree as _removeWorktree,
  syncWorktreeToMain as _syncWorktreeToMain,
  revertWorktreeCommit as _revertWorktreeCommit,
  undoMergeCommit as _undoMergeCommit,
  worktreeHasPendingChanges as _worktreeHasPendingChanges,
  checkConflicts as _checkConflicts,
  cleanupStaleWorktrees as _cleanupStaleWorktrees,
  getManagedWorktreeBranch,
} from "../worktree.js";
import { runPostCreate } from "./post-create.js";

/**
 * WorktreeWorkspace — thin adapter wrapping existing worktree.ts functions
 * into the Workspace plugin interface.
 *
 * All git logic remains in worktree.ts. This class only adapts method
 * signatures and adds postCreate hook support.
 */
export class WorktreeWorkspace implements Workspace {
  readonly name = "worktree";
  private postCreateConfig?: PostCreateConfig;

  constructor(opts?: { postCreate?: PostCreateConfig }) {
    this.postCreateConfig = opts?.postCreate;
  }

  create(config: WorkspaceCreateConfig): WorkspaceInfo | null {
    const path = _createWorktree(
      config.repoRoot,
      config.agentId,
      config.agentName,
      config.owner,
    );
    if (!path) return null;

    const branch = getManagedWorktreeBranch(config.agentName, config.agentId);
    const info: WorkspaceInfo = { path, branch, agentId: config.agentId };

    // Fire postCreate hooks (non-blocking — errors logged, not thrown)
    if (this.postCreateConfig) {
      runPostCreate(info, config.repoRoot, this.postCreateConfig).catch((err) =>
        console.warn("[Workspace postCreate] Unexpected error:", err),
      );
    }

    return info;
  }

  // Note: removeWorktree signature is (worktreePath, branch, workspace?)
  destroy(repoRoot: string, worktreePath: string, branch: string): void {
    _removeWorktree(worktreePath, branch, repoRoot);
  }

  sync(repoRoot: string, worktreePath: string): void {
    _syncWorktreeToMain(repoRoot, worktreePath);
  }

  merge(
    repoRoot: string,
    worktreePath: string,
    branch: string,
    opts?: { keepAlive?: boolean; summary?: string; agentName?: string; agentId?: string },
  ): WorkspaceMergeResult {
    return _mergeWorktree(
      repoRoot,
      worktreePath,
      branch,
      opts?.keepAlive,
      opts?.summary,
      opts?.agentName,
      opts?.agentId,
    );
  }

  revert(repoRoot: string, worktreePath: string): WorktreeRevertResult {
    return _revertWorktreeCommit(repoRoot, worktreePath);
  }

  undoMerge(repoRoot: string, commitHash: string): { success: boolean; message?: string; method?: "reset" | "revert" } {
    return _undoMergeCommit(repoRoot, commitHash);
  }

  hasPendingChanges(repoRoot: string, worktreePath: string): boolean {
    return _worktreeHasPendingChanges(repoRoot, worktreePath);
  }

  checkConflicts(repoRoot: string, branch: string): string[] {
    return _checkConflicts(repoRoot, branch);
  }

  cleanup(
    repoRoot: string,
    activeBranches: Set<string>,
    options?: CleanupWorktreeOptions,
  ): { removedBranches: string[]; removedWorktrees: string[] } {
    return _cleanupStaleWorktrees(repoRoot, activeBranches, options);
  }

  async postCreate(info: WorkspaceInfo, repoRoot: string, config: PostCreateConfig): Promise<void> {
    return runPostCreate(info, repoRoot, config);
  }
}
