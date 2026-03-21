import { execSync } from "child_process";
import { existsSync, readdirSync, rmdirSync } from "fs";
import path from "path";

const TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// Git environment isolation (prevents worktree cross-contamination)
// Inspired by Aperant's git-isolation.ts — clears env vars that cause
// one worktree's git commands to accidentally target another repo.
// ---------------------------------------------------------------------------

const GIT_ENV_VARS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
] as const;

/**
 * Create a clean environment for git subprocess operations.
 * Removes git-specific env vars that leak between worktrees and sets HUSKY=0
 * to prevent user hooks from interfering with agent-managed commits.
 */
export function getIsolatedGitEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv };
  for (const varName of GIT_ENV_VARS_TO_CLEAR) {
    delete env[varName];
  }
  env.HUSKY = "0";
  return env;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: "ignore",
      timeout: TIMEOUT,
      env: getIsolatedGitEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

function gitExec(cmd: string, cwd: string, opts?: { encoding?: "utf-8" }): string {
  return execSync(cmd, {
    cwd,
    stdio: opts?.encoding ? "pipe" : "pipe",
    encoding: opts?.encoding ?? "utf-8",
    timeout: TIMEOUT,
    env: getIsolatedGitEnv(),
  }).toString().trim();
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

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

  // Reuse existing worktree if already on the expected branch
  try {
    if (existsSync(worktreePath) && isGitRepo(worktreePath)) {
      const currentBranch = gitExec("git branch --show-current", worktreePath);
      if (currentBranch === branch) {
        console.log(`[Worktree] Reusing existing worktree: ${worktreePath} (branch: ${branch})`);
        return worktreePath;
      }
      console.log(`[Worktree] Existing worktree on wrong branch (${currentBranch} != ${branch}), recreating`);
      try {
        gitExec(`git worktree remove --force "${worktreePath}"`, workspace);
      } catch { /* ignore */ }
    }
  } catch { /* fall through to create */ }

  // Prune stale worktree references before creating
  try { gitExec("git worktree prune", workspace); } catch { /* ignore */ }

  try {
    gitExec(`git worktree add "${worktreePath}" -b "${branch}"`, workspace);
    return worktreePath;
  } catch {
    // Branch may already exist — try attaching to it
    try {
      gitExec(`git worktree add "${worktreePath}" "${branch}"`, workspace);
      console.log(`[Worktree] Attached to existing branch: ${branch}`);
      return worktreePath;
    } catch (err) {
      console.error(`[Worktree] Failed to create worktree: ${(err as Error).message}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
  stagedFiles?: string[];
}

/**
 * Auto-commit any uncommitted changes in a worktree so they can be merged.
 * Returns true if a commit was created (or working tree was already clean).
 */
function autoCommitWorktree(worktreePath: string, branch: string): boolean {
  try {
    // Check if there are any changes (staged or unstaged)
    const status = gitExec("git status --porcelain", worktreePath);
    if (!status) return true; // Already clean

    // Stage all changes
    gitExec("git add -A", worktreePath);

    // Commit with a descriptive message
    const sanitizedBranch = branch.replace(/"/g, '\\"');
    gitExec(
      `git commit -m "auto-commit: agent work on ${sanitizedBranch}"`,
      worktreePath,
    );
    console.log(`[Worktree] Auto-committed uncommitted changes in ${worktreePath}`);
    return true;
  } catch (err) {
    console.error(`[Worktree] Auto-commit failed in ${worktreePath}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Merge a worktree branch back to the main branch (squash + auto-commit).
 */
export function mergeWorktree(
  workspace: string,
  worktreePath: string,
  branch: string,
  commit = true,
): MergeResult {
  try {
    // Auto-commit any uncommitted work before merging
    autoCommitWorktree(worktreePath, branch);

    gitExec(`git merge --squash "${branch}"`, workspace);

    let stagedFiles: string[] = [];
    try {
      const output = gitExec("git diff --cached --name-only", workspace);
      stagedFiles = output ? output.split("\n") : [];
    } catch { /* ignore */ }

    if (stagedFiles.length > 0 && commit) {
      const sanitizedBranch = branch.replace(/"/g, '\\"');
      gitExec(`git commit -m "merge: ${sanitizedBranch}"`, workspace);
      console.log(`[Worktree] Squash-merged and committed ${branch} (${stagedFiles.length} files)`);
    } else if (stagedFiles.length > 0) {
      // Unstage so changes appear as modified (not staged) for easier review
      gitExec("git reset HEAD", workspace);
      console.log(`[Worktree] Squash-merged ${branch} (${stagedFiles.length} files as unstaged changes)`);
    }

    // Clean up
    try { gitExec(`git worktree remove "${worktreePath}"`, workspace); } catch { /* already removed */ }
    try { gitExec(`git branch -D "${branch}"`, workspace); } catch { /* not found */ }

    return { success: true, stagedFiles };
  } catch {
    // Merge conflict
    let conflictFiles: string[] = [];
    try {
      const output = gitExec("git diff --name-only --diff-filter=U", workspace);
      conflictFiles = output ? output.split("\n") : [];
      gitExec("git reset --hard HEAD", workspace);
    } catch { /* ignore */ }

    return { success: false, conflictFiles };
  }
}

/**
 * Check for conflicts (dry run) using git merge-tree.
 */
export function checkConflicts(workspace: string, branch: string): string[] {
  try {
    gitExec(`git merge-tree --write-tree HEAD "${branch}"`, workspace);
    return [];
  } catch (err) {
    const output = (err as { stdout?: Buffer })?.stdout?.toString() ?? "";
    const files: string[] = [];
    for (const line of output.split("\n")) {
      const match = line.match(/CONFLICT.*:\s+Merge conflict in\s+(.+)/);
      if (match) files.push(match[1].trim());
    }
    return files;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function removeWorktreeOnly(worktreePath: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  try { gitExec(`git worktree remove --force "${worktreePath}"`, cwd); } catch { /* already removed */ }
}

export function removeWorktree(worktreePath: string, branch: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  try { gitExec(`git worktree remove --force "${worktreePath}"`, cwd); } catch { /* already removed */ }
  try { gitExec(`git branch -D "${branch}"`, cwd); } catch { /* not found */ }
}

/**
 * Clean up stale agent worktrees and branches from previous ungraceful shutdowns.
 */
export function cleanupStaleWorktrees(
  workspace: string,
  activeBranches: Set<string> = new Set(),
): { removedBranches: string[]; removedWorktrees: string[] } {
  const removed = { removedBranches: [] as string[], removedWorktrees: [] as string[] };
  if (!isGitRepo(workspace)) return removed;

  // 1. Prune dead worktree metadata
  try { gitExec("git worktree prune", workspace); } catch { /* ignore */ }

  // 2. Remove stale .worktrees/* directories
  const worktreeDir = path.join(workspace, ".worktrees");
  try {
    if (existsSync(worktreeDir)) {
      const entries: string[] = readdirSync(worktreeDir);
      for (const entry of entries) {
        const wtPath = path.join(worktreeDir, entry);
        try {
          gitExec(`git worktree remove --force "${wtPath}"`, workspace);
          removed.removedWorktrees.push(entry);
        } catch { /* still in use */ }
      }
      // Remove dir if empty
      try {
        if (readdirSync(worktreeDir).length === 0) {
          rmdirSync(worktreeDir);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // 3. Delete orphaned agent/* branches
  try {
    const branchOutput = gitExec('git branch --list "agent/*"', workspace);
    if (!branchOutput) return removed;

    const wtListOutput = gitExec("git worktree list --porcelain", workspace);
    const wtBranches = new Set<string>();
    for (const line of wtListOutput.split("\n")) {
      const m = line.match(/^branch refs\/heads\/(.+)/);
      if (m) wtBranches.add(m[1]);
    }

    const branches = branchOutput.split("\n").map(b => b.trim().replace(/^\*\s*/, "")).filter(Boolean);
    for (const branch of branches) {
      if (activeBranches.has(branch) || wtBranches.has(branch)) continue;
      try {
        gitExec(`git branch -D "${branch}"`, workspace);
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
