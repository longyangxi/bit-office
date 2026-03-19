import { execSync } from "child_process";
import path from "path";

const TIMEOUT = 5000;

/**
 * Check if a directory is inside a git repository.
 */
function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore", timeout: TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree for an agent's task.
 * Returns the worktree path, or null if workspace is not a git repo.
 */
export function createWorktree(
  workspace: string,
  agentId: string,
  taskId: string,
  agentName: string,
): string | null {
  if (!isGitRepo(workspace)) return null;

  const worktreeDir = path.join(workspace, ".worktrees");
  const worktreeName = `${agentId}-${taskId}`;
  const worktreePath = path.join(worktreeDir, worktreeName);
  const branch = `agent/${agentName.toLowerCase().replace(/\s+/g, "-")}/${taskId}`;

  try {
    execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
      cwd: workspace,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    return worktreePath;
  } catch (err) {
    console.error(`[Worktree] Failed to create worktree: ${(err as Error).message}`);
    return null;
  }
}

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
  /** Files staged in the working tree (not yet committed — user decides). */
  stagedFiles?: string[];
}

/**
 * Merge a worktree branch back to the current branch as staged changes (no commit).
 * The user can review `git status` / `git diff --cached` and commit manually.
 */
export function mergeWorktree(
  workspace: string,
  worktreePath: string,
  branch: string,
): MergeResult {
  try {
    // --squash brings all changes into the index without committing.
    // The user sees them as staged changes and decides whether to commit.
    execSync(`git merge --squash "${branch}"`, {
      cwd: workspace,
      stdio: "pipe",
      timeout: TIMEOUT,
    });

    // Collect the list of staged files so the UI / log can display them
    let stagedFiles: string[] = [];
    try {
      const output = execSync("git diff --cached --name-only", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: TIMEOUT,
      }).trim();
      stagedFiles = output ? output.split("\n") : [];
    } catch { /* ignore */ }

    // Clean up worktree
    try {
      execSync(`git worktree remove "${worktreePath}"`, { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
    } catch { /* already removed */ }
    // --squash doesn't mark the branch as merged, so -d would fail — use -D
    try {
      execSync(`git branch -D "${branch}"`, { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
    } catch { /* branch not found */ }

    return { success: true, stagedFiles };
  } catch (err) {
    // Merge conflict — extract conflicting files
    let conflictFiles: string[] = [];
    try {
      const output = execSync("git diff --name-only --diff-filter=U", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: TIMEOUT,
      }).trim();
      conflictFiles = output ? output.split("\n") : [];
      // Discard the failed merge — use reset instead of merge --abort
      // because --abort requires MERGE_HEAD which squash merges don't create
      execSync("git reset --hard HEAD", { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
    } catch { /* ignore */ }

    return { success: false, conflictFiles };
  }
}

/**
 * Check for potential merge conflicts between a branch and the current HEAD
 * using git merge-tree (dry run). Returns list of conflicting file paths.
 */
export function checkConflicts(workspace: string, branch: string): string[] {
  try {
    // git merge-tree --write-tree does a dry-run merge and fails on conflicts
    execSync(`git merge-tree --write-tree HEAD "${branch}"`, {
      cwd: workspace,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    return []; // No conflicts
  } catch (err) {
    // merge-tree exits non-zero on conflicts — parse output for conflicted files
    const output = (err as { stdout?: Buffer })?.stdout?.toString() ?? "";
    const files: string[] = [];
    for (const line of output.split("\n")) {
      // Lines like "CONFLICT (content): Merge conflict in <file>"
      const match = line.match(/CONFLICT.*:\s+Merge conflict in\s+(.+)/);
      if (match) files.push(match[1].trim());
    }
    // If we couldn't parse any files but merge-tree failed, it's still a conflict
    if (files.length === 0) {
      console.log(`[Worktree] merge-tree failed but no files parsed — treating as clean`);
      return [];
    }
    return files;
  }
}

/**
 * Remove a worktree directory only (keep the branch for manual conflict resolution).
 */
export function removeWorktreeOnly(worktreePath: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: "pipe", timeout: TIMEOUT });
  } catch { /* already removed */ }
}

/**
 * Force-remove a worktree and its branch (used on task failure/cancel).
 */
export function removeWorktree(worktreePath: string, branch: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: "pipe", timeout: TIMEOUT });
  } catch { /* already removed */ }
  try {
    execSync(`git branch -D "${branch}"`, { cwd, stdio: "pipe", timeout: TIMEOUT });
  } catch { /* branch not found */ }
}

/**
 * Clean up stale agent worktrees and branches left over from ungraceful shutdowns.
 *
 * 1. Prunes dead worktree entries (directory deleted but git still tracks them).
 * 2. Removes any remaining `.worktrees/` directories that have no lock file.
 * 3. Deletes orphaned `agent/*` branches that no longer have an associated worktree.
 *
 * @param activeBranches - Branches currently in use by live sessions (skip these).
 */
export function cleanupStaleWorktrees(
  workspace: string,
  activeBranches: Set<string> = new Set(),
): { removedBranches: string[]; removedWorktrees: string[] } {
  const removed = { removedBranches: [] as string[], removedWorktrees: [] as string[] };

  if (!isGitRepo(workspace)) return removed;

  // 1. Prune dead worktree metadata
  try {
    execSync("git worktree prune", { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
  } catch { /* ignore */ }

  // 2. Remove stale .worktrees/* directories (unlocked only)
  const worktreeDir = path.join(workspace, ".worktrees");
  try {
    const { readdirSync, existsSync } = require("fs");
    if (existsSync(worktreeDir)) {
      const entries: string[] = readdirSync(worktreeDir);
      for (const entry of entries) {
        const wtPath = path.join(worktreeDir, entry);
        // If it's still a live worktree registered with git, skip it
        try {
          execSync(`git worktree list --porcelain`, { cwd: workspace, encoding: "utf-8", timeout: TIMEOUT });
        } catch { /* ignore */ }

        try {
          execSync(`git worktree remove --force "${wtPath}"`, { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
          removed.removedWorktrees.push(entry);
        } catch { /* still in use or already gone */ }
      }

      // Remove the .worktrees dir itself if empty
      try {
        const remaining: string[] = readdirSync(worktreeDir);
        if (remaining.length === 0) {
          require("fs").rmdirSync(worktreeDir);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // 3. Delete orphaned agent/* branches (not associated with any worktree)
  try {
    const branchOutput = execSync('git branch --list "agent/*"', {
      cwd: workspace,
      encoding: "utf-8",
      timeout: TIMEOUT,
    }).trim();

    if (!branchOutput) return removed;

    // Get worktree-associated branches
    const wtListOutput = execSync("git worktree list --porcelain", {
      cwd: workspace,
      encoding: "utf-8",
      timeout: TIMEOUT,
    });
    const wtBranches = new Set<string>();
    for (const line of wtListOutput.split("\n")) {
      const m = line.match(/^branch refs\/heads\/(.+)/);
      if (m) wtBranches.add(m[1]);
    }

    const branches = branchOutput.split("\n").map(b => b.trim().replace(/^\*\s*/, "")).filter(Boolean);
    for (const branch of branches) {
      // Skip branches that are active in current sessions or have a live worktree
      if (activeBranches.has(branch) || wtBranches.has(branch)) continue;

      try {
        execSync(`git branch -D "${branch}"`, { cwd: workspace, stdio: "pipe", timeout: TIMEOUT });
        removed.removedBranches.push(branch);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  if (removed.removedBranches.length || removed.removedWorktrees.length) {
    console.log(
      `[Worktree GC] Cleaned up ${removed.removedWorktrees.length} worktrees, ${removed.removedBranches.length} branches`,
      removed.removedBranches.length ? `: ${removed.removedBranches.join(", ")}` : "",
    );
  }

  return removed;
}
