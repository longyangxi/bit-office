import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

const TIMEOUT = 5000;

// Cached git version (parsed once per process)
let cachedGitVersion: [number, number, number] | null = null;

/**
 * Parse the git version string (e.g. "git version 2.19.0") into [major, minor, patch].
 */
function getGitVersion(cwd?: string): [number, number, number] {
  if (cachedGitVersion) return cachedGitVersion;
  try {
    const raw = execSync("git --version", {
      cwd: cwd ?? process.cwd(),
      encoding: "utf-8",
      stdio: "pipe",
      timeout: TIMEOUT,
    }).trim();
    const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      cachedGitVersion = [Number(match[1]), Number(match[2]), Number(match[3])];
      return cachedGitVersion;
    }
  } catch { /* ignore */ }
  return [0, 0, 0];
}

/**
 * Check if the installed git version is >= the given version.
 */
function gitVersionAtLeast(major: number, minor: number, patch = 0): boolean {
  const [a, b, c] = getGitVersion();
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

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

export interface WorktreeOwnerInfo {
  gatewayId: string;
  machineId: string;
  instanceDir: string;
  pid: number;
  startedAt: number;
  agentId: string;
  taskId: string;
  agentName: string;
  branch: string;
}

export interface RuntimeOwnerInfo {
  gatewayId: string;
  machineId: string;
  instanceDir: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
}

export interface CleanupWorktreeOptions {
  ownedAgentIds?: Set<string>;
  currentOwner?: RuntimeOwnerInfo;
  runtimeTtlMs?: number;
}

const WORKTREE_OWNER_DIR = ".owners";
const DEFAULT_RUNTIME_TTL_MS = 60_000;

function getWorktreeOwnerFile(worktreePath: string): string {
  const root = path.dirname(path.dirname(worktreePath));
  return path.join(root, ".worktrees", WORKTREE_OWNER_DIR, `${path.basename(worktreePath)}.json`);
}

function writeWorktreeOwnerFile(worktreePath: string, owner: WorktreeOwnerInfo): void {
  try {
    const file = getWorktreeOwnerFile(worktreePath);
    const dir = path.dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(owner, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[Worktree] Failed to write owner file for ${worktreePath}: ${(err as Error).message}`);
  }
}

function removeWorktreeOwnerFile(worktreePath: string): void {
  try {
    unlinkSync(getWorktreeOwnerFile(worktreePath));
  } catch { /* ignore */ }
}

function readWorktreeOwnerFile(worktreePath: string): WorktreeOwnerInfo | null {
  try {
    const raw = JSON.parse(readFileSync(getWorktreeOwnerFile(worktreePath), "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.agentId !== "string" || typeof raw.branch !== "string" || typeof raw.instanceDir !== "string") {
      return null;
    }
    return raw as WorktreeOwnerInfo;
  } catch {
    return null;
  }
}

function readRuntimeOwnerFile(instanceDir: string): RuntimeOwnerInfo | null {
  try {
    const file = path.join(instanceDir, "runtime.json");
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.pid !== "number" || typeof raw.heartbeatAt !== "number" || typeof raw.startedAt !== "number") {
      return null;
    }
    return raw as RuntimeOwnerInfo;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRuntimeAlive(runtime: RuntimeOwnerInfo | null, ttlMs: number): boolean {
  if (!runtime) return false;
  if (!isPidAlive(runtime.pid)) return false;
  return Date.now() - runtime.heartbeatAt <= ttlMs;
}

function shouldCleanWorktree(
  entry: string,
  wtPath: string,
  owner: WorktreeOwnerInfo | null,
  options: CleanupWorktreeOptions | undefined,
): boolean {
  const ownedAgentIds = options?.ownedAgentIds;
  if (owner) {
    const current = options?.currentOwner;
    if (current
      && owner.gatewayId === current.gatewayId
      && owner.instanceDir === current.instanceDir
      && owner.startedAt === current.startedAt) {
      return true;
    }
    const ttlMs = options?.runtimeTtlMs ?? DEFAULT_RUNTIME_TTL_MS;
    return !isRuntimeAlive(readRuntimeOwnerFile(owner.instanceDir), ttlMs);
  }

  if (!ownedAgentIds) return false;
  return Array.from(ownedAgentIds).some(id => entry.startsWith(`${id}-`) || path.basename(wtPath) === id);
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
  owner?: Omit<WorktreeOwnerInfo, "agentId" | "taskId" | "agentName" | "branch">,
): string | null {
  if (!isGitRepo(workspace)) return null;

  const worktreeDir = path.join(workspace, ".worktrees");
  const worktreeName = `${agentId}-${taskId}`;
  const worktreePath = path.join(worktreeDir, worktreeName);
  const branch = `agent/${agentName.toLowerCase().replace(/\s+/g, "-")}/${taskId}`;
  const ownerInfo: WorktreeOwnerInfo | undefined = owner
    ? { ...owner, agentId, taskId, agentName, branch }
    : undefined;

  // Reuse existing worktree if already on the expected branch
  try {
    if (existsSync(worktreePath) && isGitRepo(worktreePath)) {
      const currentBranch = gitExec("git branch --show-current", worktreePath);
      if (currentBranch === branch) {
        // Fast-forward worktree to main HEAD so agent doesn't fork
        try {
          const mainHead = gitExec("git rev-parse HEAD", workspace);
          const wtHead = gitExec("git rev-parse HEAD", worktreePath);
          if (wtHead !== mainHead) {
            const isAncestor = (() => { try { gitExec(`git merge-base --is-ancestor ${wtHead} ${mainHead}`, workspace); return true; } catch { return false; } })();
            if (isAncestor) {
              gitExec(`git reset --hard ${mainHead}`, worktreePath);
              console.log(`[Worktree] Reusing worktree, fast-forwarded to main HEAD: ${mainHead.slice(0, 7)}`);
            } else {
              console.log(`[Worktree] Reusing worktree with unmerged commits, skipping fast-forward`);
            }
          } else {
            console.log(`[Worktree] Reusing existing worktree: ${worktreePath} (branch: ${branch})`);
          }
        } catch {
          console.log(`[Worktree] Reusing existing worktree: ${worktreePath} (branch: ${branch})`);
        }
        if (ownerInfo) writeWorktreeOwnerFile(worktreePath, ownerInfo);
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
    if (ownerInfo) writeWorktreeOwnerFile(worktreePath, ownerInfo);
    return worktreePath;
  } catch {
    // Branch may already exist — try attaching to it
    try {
      gitExec(`git worktree add "${worktreePath}" "${branch}"`, workspace);
      // Fast-forward attached branch to main HEAD to avoid forking
      try {
        const mainHead = gitExec("git rev-parse HEAD", workspace);
        const branchHead = gitExec("git rev-parse HEAD", worktreePath);
        if (branchHead !== mainHead) {
          const isAncestor = (() => { try { gitExec(`git merge-base --is-ancestor ${branchHead} ${mainHead}`, workspace); return true; } catch { return false; } })();
          if (isAncestor) {
            gitExec(`git reset --hard ${mainHead}`, worktreePath);
            console.log(`[Worktree] Attached to branch ${branch}, fast-forwarded to main HEAD: ${mainHead.slice(0, 7)}`);
          } else {
            console.log(`[Worktree] Attached to branch ${branch} with unmerged commits, skipping fast-forward`);
          }
        } else {
          console.log(`[Worktree] Attached to existing branch: ${branch}`);
        }
      } catch {
        console.log(`[Worktree] Attached to existing branch: ${branch}`);
      }
      if (ownerInfo) writeWorktreeOwnerFile(worktreePath, ownerInfo);
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
  keepAlive = false,
  summary?: string,
): MergeResult {
  try {
    autoCommitWorktree(worktreePath, branch);
    gitExec(`git merge --squash "${branch}"`, workspace);

    let stagedFiles: string[] = [];
    try {
      const output = gitExec("git diff --cached --name-only", workspace);
      stagedFiles = output ? output.split("\n") : [];
    } catch { /* ignore */ }

    if (stagedFiles.length > 0) {
      const raw = summary ? summary.split("\n")[0].trim().slice(0, 72) : `merge: ${branch}`;
      const msg = raw || `merge: ${branch}`;
      // Use env var to pass commit message — avoids shell injection from
      // backticks, quotes, or other special chars in agent summary output.
      execSync(`git commit -m "$COMMIT_MSG"`, {
        cwd: workspace,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: TIMEOUT,
        env: { ...getIsolatedGitEnv(), COMMIT_MSG: msg },
      });
      console.log(`[Worktree] Squash-merged and committed ${branch} (${stagedFiles.length} files)`);
    }

    if (!keepAlive) {
      // Clean up worktree + branch
      removeWorktreeOwnerFile(worktreePath);
      try { gitExec(`git worktree remove "${worktreePath}"`, workspace); } catch { /* already removed */ }
      try { gitExec(`git branch -D "${branch}"`, workspace); } catch { /* not found */ }
    } else {
      // Keep worktree alive for session continuity — reset branch to main repo HEAD
      // so next task starts from the merged state (avoids forking)
      try {
        const mainHead = gitExec("git rev-parse HEAD", workspace);
        gitExec(`git reset --hard ${mainHead}`, worktreePath);
      } catch { /* ignore */ }
      console.log(`[Worktree] Merged ${branch}, worktree kept alive for session continuity`);
    }

    return { success: true, stagedFiles };
  } catch (err) {
    console.error(`[Worktree] Merge failed for ${branch}:`, (err as Error).message);
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
 * Check for conflicts (dry run).
 * Uses `git merge-tree --write-tree` on git >= 2.38, otherwise falls back to
 * `git merge --no-commit --no-ff` + `git merge --abort` for older versions
 * (e.g. macOS bundled git 2.19).
 */
export function checkConflicts(workspace: string, branch: string): string[] {
  if (gitVersionAtLeast(2, 38)) {
    // Modern path: pure dry-run, no working tree changes
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

  // Fallback for git < 2.38: attempt a real merge and immediately abort
  try {
    gitExec(`git merge --no-commit --no-ff "${branch}"`, workspace);
    // Merge succeeded (no conflicts) — abort to undo
    try { gitExec("git merge --abort", workspace); } catch { /* ignore */ }
    return [];
  } catch (err) {
    // Merge failed — extract conflict files, then abort
    const conflictFiles: string[] = [];
    try {
      const output = gitExec("git diff --name-only --diff-filter=U", workspace);
      if (output) conflictFiles.push(...output.split("\n").filter(Boolean));
    } catch { /* ignore */ }
    try { gitExec("git merge --abort", workspace); } catch {
      // If --abort fails, hard reset as last resort
      try { gitExec("git reset --hard HEAD", workspace); } catch { /* ignore */ }
    }
    return conflictFiles;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function removeWorktreeOnly(worktreePath: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  removeWorktreeOwnerFile(worktreePath);
  try { gitExec(`git worktree remove --force "${worktreePath}"`, cwd); } catch { /* already removed */ }
}

export function removeWorktree(worktreePath: string, branch: string, workspace?: string): void {
  const cwd = workspace ?? path.dirname(path.dirname(worktreePath));
  removeWorktreeOwnerFile(worktreePath);
  try { gitExec(`git worktree remove --force "${worktreePath}"`, cwd); } catch { /* already removed */ }
  try { gitExec(`git branch -D "${branch}"`, cwd); } catch { /* not found */ }
}

/**
 * Clean up stale agent worktrees and branches from previous ungraceful shutdowns.
 * Uses owner metadata when available, and falls back to ownedAgentIds for legacy worktrees.
 */
export function cleanupStaleWorktrees(
  workspace: string,
  activeBranches: Set<string> = new Set(),
  options?: CleanupWorktreeOptions,
): { removedBranches: string[]; removedWorktrees: string[] } {
  const removed = { removedBranches: [] as string[], removedWorktrees: [] as string[] };
  if (!isGitRepo(workspace)) return removed;

  // 1. Prune dead worktree metadata
  try { gitExec("git worktree prune", workspace); } catch { /* ignore */ }

  // 2. Remove stale .worktrees/* directories we can prove are ours or dead.
  const cleanedBranches = new Set<string>();
  const cleanedTaskIds = new Set<string>();
  const worktreeDir = path.join(workspace, ".worktrees");
  try {
    if (existsSync(worktreeDir)) {
      const entries: string[] = readdirSync(worktreeDir);
      for (const entry of entries) {
        const wtPath = path.join(worktreeDir, entry);
        const owner = readWorktreeOwnerFile(wtPath);
        if (!shouldCleanWorktree(entry, wtPath, owner, options)) continue;
        try {
          removeWorktreeOwnerFile(wtPath);
          gitExec(`git worktree remove --force "${wtPath}"`, workspace);
          removed.removedWorktrees.push(entry);
          if (owner?.branch) {
            cleanedBranches.add(owner.branch);
            cleanedTaskIds.add(owner.taskId);
          } else if (options?.ownedAgentIds) {
            const matchingId = Array.from(options.ownedAgentIds).find(id => entry.startsWith(`${id}-`));
            if (matchingId && entry.length > matchingId.length + 1) {
              cleanedTaskIds.add(entry.slice(matchingId.length + 1));
            }
          }
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
  // When scoped, only delete branches matching worktrees we actually removed.
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
      if (cleanedBranches.size > 0 && !cleanedBranches.has(branch)) {
        continue;
      }
      if (cleanedBranches.size === 0 && options?.ownedAgentIds) {
        const branchTaskId = branch.split("/").pop();
        if (!branchTaskId || !cleanedTaskIds.has(branchTaskId)) continue;
      }
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
