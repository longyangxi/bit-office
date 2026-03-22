import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { homedir } from "os";

const TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// Centralized worktree storage
// All agent worktrees live under ~/.open-office[-dev]/worktrees/<repo-hash>/
// This keeps them physically outside any repo, avoiding upward-traversal issues
// (Claude Code / agents walking up to find project root, CLAUDE.md, etc.).
// ---------------------------------------------------------------------------

const OPEN_OFFICE_DIR = path.join(homedir(),
  process.env.NODE_ENV === "development" ? ".open-office-dev" : ".open-office");
const WORKTREE_BASE_DIR = path.join(OPEN_OFFICE_DIR, "worktrees");

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6);
}

/** Return the centralized worktree directory for a given repo root. */
function getWorktreeDir(repoRoot: string): string {
  const name = path.basename(repoRoot);
  const hash = simpleHash(repoRoot);
  return path.join(WORKTREE_BASE_DIR, `${name}-${hash}`);
}

/** Expose the base dir so gateway can reference it. */
export function getWorktreeBaseDir(): string {
  return WORKTREE_BASE_DIR;
}

// Cached git version (parsed once per process)
let cachedGitVersion: [number, number, number] | null = null;

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

function gitVersionAtLeast(major: number, minor: number, patch = 0): boolean {
  const [a, b, c] = getGitVersion();
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

// ---------------------------------------------------------------------------
// Git environment isolation (prevents worktree cross-contamination)
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
// Owner metadata — lives alongside worktrees in the centralized dir
// ---------------------------------------------------------------------------

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
  repoRoot: string;
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
  const worktreeDir = path.dirname(worktreePath);
  return path.join(worktreeDir, WORKTREE_OWNER_DIR, `${path.basename(worktreePath)}.json`);
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

function gitExec(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    timeout: TIMEOUT,
    env: getIsolatedGitEnv(),
  }).toString().trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeBranchSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function getManagedWorktreeBranch(agentName: string, taskId: string): string {
  const safeTaskId = sanitizeBranchSegment(taskId);
  const safeAgentName = sanitizeBranchSegment(agentName.toLowerCase().replace(/\s+/g, "-"));
  return `agent/${safeAgentName}/${safeTaskId}`;
}

export function resolveGitWorkspaceRoot(workspace: string): string {
  try {
    const commonDir = gitExec("git rev-parse --path-format=absolute --git-common-dir", workspace);
    if (commonDir) return path.dirname(commonDir);
  } catch { /* ignore */ }
  return workspace;
}

function findWorktreePathForBranch(repoRoot: string, branch: string): string | null {
  try {
    const output = gitExec("git worktree list --porcelain", repoRoot);
    let currentPath: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length).trim();
        continue;
      }
      if (line.startsWith("branch ") && currentPath) {
        const currentBranch = line.slice("branch refs/heads/".length).trim();
        if (currentBranch === branch) return currentPath;
      }
      if (!line.trim()) currentPath = null;
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a git worktree for an agent's task.
 * Worktrees are stored centrally at ~/.open-office[-dev]/worktrees/<repo-hash>/
 * Returns the worktree path, or null if workspace is not a git repo.
 */
export function createWorktree(
  workspace: string,
  agentId: string,
  taskId: string,
  agentName: string,
  owner?: Omit<WorktreeOwnerInfo, "agentId" | "taskId" | "agentName" | "branch" | "repoRoot">,
): string | null {
  if (!isGitRepo(workspace)) return null;
  const repoRoot = resolveGitWorkspaceRoot(workspace);

  const worktreeDir = getWorktreeDir(repoRoot);
  if (!existsSync(worktreeDir)) mkdirSync(worktreeDir, { recursive: true });
  const safeTaskId = sanitizeBranchSegment(taskId);
  const worktreeName = `${agentId}-${safeTaskId}`;
  let worktreePath = path.join(worktreeDir, worktreeName);
  const branch = getManagedWorktreeBranch(agentName, taskId);
  const ownerInfo: WorktreeOwnerInfo | undefined = owner
    ? { ...owner, agentId, taskId, agentName, branch, repoRoot }
    : undefined;

  // Reuse existing worktree if already on the expected branch
  try {
    if (existsSync(worktreePath) && isGitRepo(worktreePath)) {
      const currentBranch = gitExec("git branch --show-current", worktreePath);
      if (currentBranch === branch) {
        // Fast-forward worktree to main HEAD so agent doesn't fork
        try {
          const mainHead = gitExec("git rev-parse HEAD", repoRoot);
          const wtHead = gitExec("git rev-parse HEAD", worktreePath);
          if (wtHead !== mainHead) {
            const isAncestor = (() => { try { gitExec(`git merge-base --is-ancestor ${shellQuote(wtHead)} ${shellQuote(mainHead)}`, repoRoot); return true; } catch { return false; } })();
            if (isAncestor) {
              gitExec(`git reset --hard ${shellQuote(mainHead)}`, worktreePath);
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
        gitExec(`git worktree remove --force ${shellQuote(worktreePath)}`, repoRoot);
      } catch { /* ignore */ }
    }
  } catch { /* fall through to create */ }

  // Prune stale worktree references before creating
  try { gitExec("git worktree prune", repoRoot); } catch { /* ignore */ }

  const attachedWorktreePath = findWorktreePathForBranch(repoRoot, branch);
  if (attachedWorktreePath && attachedWorktreePath !== worktreePath) {
    if (existsSync(attachedWorktreePath) && isGitRepo(attachedWorktreePath)) {
      if (ownerInfo) writeWorktreeOwnerFile(attachedWorktreePath, ownerInfo);
      console.log(`[Worktree] Reusing branch ${branch} already attached at ${attachedWorktreePath}`);
      return attachedWorktreePath;
    }
    try { gitExec("git worktree prune", repoRoot); } catch { /* ignore */ }
  }

  if (existsSync(worktreePath) && !isGitRepo(worktreePath)) {
    try { rmdirSync(worktreePath); } catch { /* ignore */ }
    if (existsSync(worktreePath)) {
      for (let i = 1; i <= 20; i++) {
        const candidate = path.join(worktreeDir, `${worktreeName}-${i}`);
        if (!existsSync(candidate)) {
          worktreePath = candidate;
          break;
        }
      }
    }
  }

  try {
    gitExec(`git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)}`, repoRoot);
    if (ownerInfo) writeWorktreeOwnerFile(worktreePath, ownerInfo);
    return worktreePath;
  } catch {
    // Branch may already exist — try attaching to it
    try {
      gitExec(`git worktree add ${shellQuote(worktreePath)} ${shellQuote(branch)}`, repoRoot);
      // Fast-forward attached branch to main HEAD to avoid forking
      try {
        const mainHead = gitExec("git rev-parse HEAD", repoRoot);
        const branchHead = gitExec("git rev-parse HEAD", worktreePath);
        if (branchHead !== mainHead) {
          const isAncestor = (() => { try { gitExec(`git merge-base --is-ancestor ${shellQuote(branchHead)} ${shellQuote(mainHead)}`, repoRoot); return true; } catch { return false; } })();
          if (isAncestor) {
            gitExec(`git reset --hard ${shellQuote(mainHead)}`, worktreePath);
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

function autoCommitWorktree(worktreePath: string, branch: string): boolean {
  try {
    const status = gitExec("git status --porcelain", worktreePath);
    if (!status) return true;

    gitExec("git add -A", worktreePath);

    execSync(`git commit -m "$COMMIT_MSG"`, {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: TIMEOUT,
      env: { ...getIsolatedGitEnv(), COMMIT_MSG: `auto-commit: agent work on ${branch}` },
    });
    console.log(`[Worktree] Auto-committed uncommitted changes in ${worktreePath}`);
    return true;
  } catch (err) {
    console.error(`[Worktree] Auto-commit failed in ${worktreePath}: ${(err as Error).message}`);
    return false;
  }
}

export function mergeWorktree(
  workspace: string,
  worktreePath: string,
  branch: string,
  keepAlive = false,
  summary?: string,
): MergeResult {
  const repoRoot = resolveGitWorkspaceRoot(workspace);
  try {
    autoCommitWorktree(worktreePath, branch);
    gitExec(`git merge --squash ${shellQuote(branch)}`, repoRoot);

    let stagedFiles: string[] = [];
    try {
      const output = gitExec("git diff --cached --name-only", repoRoot);
      stagedFiles = output ? output.split("\n") : [];
    } catch { /* ignore */ }

    if (stagedFiles.length > 0) {
      const raw = summary ? summary.split("\n")[0].trim().slice(0, 72) : `merge: ${branch}`;
      const msg = raw || `merge: ${branch}`;
      execSync(`git commit -m "$COMMIT_MSG"`, {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: TIMEOUT,
        env: { ...getIsolatedGitEnv(), COMMIT_MSG: msg },
      });
      console.log(`[Worktree] Squash-merged and committed ${branch} (${stagedFiles.length} files)`);
    }

    if (!keepAlive) {
      removeWorktreeOwnerFile(worktreePath);
      try { gitExec(`git worktree remove ${shellQuote(worktreePath)}`, repoRoot); } catch { /* already removed */ }
      try { gitExec(`git branch -D ${shellQuote(branch)}`, repoRoot); } catch { /* not found */ }
    } else {
      try {
        const mainHead = gitExec("git rev-parse HEAD", repoRoot);
        gitExec(`git reset --hard ${shellQuote(mainHead)}`, worktreePath);
      } catch { /* ignore */ }
      console.log(`[Worktree] Merged ${branch}, worktree kept alive for session continuity`);
    }

    return { success: true, stagedFiles };
  } catch (err) {
    console.error(`[Worktree] Merge failed for ${branch}:`, (err as Error).message);
    let conflictFiles: string[] = [];
    try {
      const output = gitExec("git diff --name-only --diff-filter=U", repoRoot);
      conflictFiles = output ? output.split("\n") : [];
      gitExec("git reset --hard HEAD", repoRoot);
    } catch { /* ignore */ }

    return { success: false, conflictFiles };
  }
}

export function checkConflicts(workspace: string, branch: string): string[] {
  const repoRoot = resolveGitWorkspaceRoot(workspace);
  if (gitVersionAtLeast(2, 38)) {
    try {
      gitExec(`git merge-tree --write-tree HEAD ${shellQuote(branch)}`, repoRoot);
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

  try {
    gitExec(`git merge --no-commit --no-ff ${shellQuote(branch)}`, repoRoot);
    try { gitExec("git merge --abort", repoRoot); } catch { /* ignore */ }
    return [];
  } catch {
    const conflictFiles: string[] = [];
    try {
      const output = gitExec("git diff --name-only --diff-filter=U", repoRoot);
      if (output) conflictFiles.push(...output.split("\n").filter(Boolean));
    } catch { /* ignore */ }
    try { gitExec("git merge --abort", repoRoot); } catch {
      try { gitExec("git reset --hard HEAD", repoRoot); } catch { /* ignore */ }
    }
    return conflictFiles;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Resolve the repo root for a worktree path.
 * Since the worktree is linked to its parent repo, git commands inside it
 * can resolve back to the main repo — even when the worktree is external.
 */
function resolveRepoFromWorktree(worktreePath: string): string | null {
  if (!existsSync(worktreePath)) return null;
  try {
    return resolveGitWorkspaceRoot(worktreePath);
  } catch {
    return null;
  }
}

export function removeWorktreeOnly(worktreePath: string, workspace?: string): void {
  const cwd = workspace
    ? resolveGitWorkspaceRoot(workspace)
    : (resolveRepoFromWorktree(worktreePath) ?? process.cwd());
  removeWorktreeOwnerFile(worktreePath);
  try { gitExec(`git worktree remove --force ${shellQuote(worktreePath)}`, cwd); } catch { /* already removed */ }
}

export function removeWorktree(worktreePath: string, branch: string, workspace?: string): void {
  const cwd = workspace
    ? resolveGitWorkspaceRoot(workspace)
    : (resolveRepoFromWorktree(worktreePath) ?? process.cwd());
  removeWorktreeOwnerFile(worktreePath);
  try { gitExec(`git worktree remove --force ${shellQuote(worktreePath)}`, cwd); } catch { /* already removed */ }
  try { gitExec(`git branch -D ${shellQuote(branch)}`, cwd); } catch { /* not found */ }
}

/**
 * Clean up stale agent worktrees and branches.
 * Scans ~/.open-office[-dev]/worktrees/<repo-hash>/ for the given workspace.
 */
export function cleanupStaleWorktrees(
  workspace: string,
  activeBranches: Set<string> = new Set(),
  options?: CleanupWorktreeOptions,
): { removedBranches: string[]; removedWorktrees: string[] } {
  const removed = { removedBranches: [] as string[], removedWorktrees: [] as string[] };
  if (!isGitRepo(workspace)) return removed;
  const repoRoot = resolveGitWorkspaceRoot(workspace);

  // 1. Prune dead worktree metadata
  try { gitExec("git worktree prune", repoRoot); } catch { /* ignore */ }

  // 2. Remove stale worktree directories from centralized storage.
  const cleanedBranches = new Set<string>();
  const worktreeDir = getWorktreeDir(repoRoot);

  // Also check legacy in-repo .worktrees/ location for migration
  const legacyWorktreeDir = path.join(repoRoot, ".worktrees");
  const dirsToScan = [worktreeDir, legacyWorktreeDir];

  for (const dir of dirsToScan) {
    try {
      if (!existsSync(dir)) continue;
      const entries: string[] = readdirSync(dir);
      for (const entry of entries) {
        if (entry === WORKTREE_OWNER_DIR) continue;
        const wtPath = path.join(dir, entry);
        const owner = readWorktreeOwnerFile(wtPath);
        if (!shouldCleanWorktree(entry, wtPath, owner, options)) continue;
        try {
          removeWorktreeOwnerFile(wtPath);
          gitExec(`git worktree remove --force ${shellQuote(wtPath)}`, repoRoot);
          removed.removedWorktrees.push(entry);
          if (owner?.branch) cleanedBranches.add(owner.branch);
        } catch { /* still in use */ }
      }
      // Remove dir if empty (skip base dir)
      if (dir !== WORKTREE_BASE_DIR) {
        try {
          const remaining = readdirSync(dir).filter(e => e !== WORKTREE_OWNER_DIR);
          if (remaining.length === 0) {
            // Remove .owners dir then the worktree dir itself
            const ownersDir = path.join(dir, WORKTREE_OWNER_DIR);
            if (existsSync(ownersDir)) {
              try { const files = readdirSync(ownersDir); for (const f of files) unlinkSync(path.join(ownersDir, f)); rmdirSync(ownersDir); } catch { /* ignore */ }
            }
            try { rmdirSync(dir); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // 3. Delete orphaned agent/* branches.
  // A branch is orphaned if it's not in activeBranches and not checked out in any worktree.
  try {
    const branchOutput = gitExec('git branch --list "agent/*"', repoRoot);
    if (!branchOutput) return removed;

    const wtListOutput = gitExec("git worktree list --porcelain", repoRoot);
    const wtBranches = new Set<string>();
    for (const line of wtListOutput.split("\n")) {
      const m = line.match(/^branch refs\/heads\/(.+)/);
      if (m) wtBranches.add(m[1]);
    }

    const branches = branchOutput.split("\n").map(b => b.trim().replace(/^\*\s*/, "")).filter(Boolean);
    for (const branch of branches) {
      if (activeBranches.has(branch) || wtBranches.has(branch)) continue;
      // If we cleaned specific worktrees, only delete their branches.
      // If no worktrees were cleaned (dirs already gone), delete all orphaned branches.
      if (cleanedBranches.size > 0 && !cleanedBranches.has(branch)) continue;
      try {
        gitExec(`git branch -D ${shellQuote(branch)}`, repoRoot);
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
