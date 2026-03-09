// ---------------------------------------------------------------------------
// ResultFinalizer — encapsulates the team-level result finalization logic.
//
// When a team leader completes and the orchestrator decides to finalize,
// this class handles: merging worker data, validating entryFile, resolving
// preview URLs through a cascading fallback chain.
// ---------------------------------------------------------------------------

import path from "path";
import { CONFIG } from "./config.js";
import { resolveAgentPath } from "./resolve-path.js";
import { resolvePreview } from "./preview-resolver.js";
import type { TaskResultPayload } from "./types.js";

/** Preview info captured from dev workers — ground truth */
export interface TeamPreview {
  previewUrl?: string;
  previewPath?: string;
  entryFile?: string;
  previewCmd?: string;
  previewPort?: number;
}

/** Context needed for finalization */
export interface FinalizeContext {
  /** Result payload from the leader's task completion (will be mutated) */
  result: TaskResultPayload;
  /** Preview captured from dev workers (ground truth, preferred over leader's) */
  teamPreview: TeamPreview | null;
  /** Accumulated changedFiles from all workers */
  teamChangedFiles: Set<string>;
  /** Team project directory (from delegation router) */
  projectDir: string | null;
  /** Workspace root */
  workspace: string;
  /** Callback to detect preview from a specific worker agent */
  detectWorkerPreview: () => { previewUrl: string | undefined; previewPath: string | undefined } | null;
}

/**
 * Finalize a team leader's result — enrich with team-level data and resolve preview.
 * Mutates `ctx.result` in place.
 */
export function finalizeTeamResult(ctx: FinalizeContext): void {
  const { result, teamPreview, teamChangedFiles, projectDir, workspace } = ctx;

  // 1. Merge accumulated worker changedFiles into the leader's result
  if (teamChangedFiles.size > 0) {
    const merged = new Set(result.changedFiles ?? []);
    for (const f of teamChangedFiles) merged.add(f);
    result.changedFiles = Array.from(merged);
  }

  // 2. Inject correct project directory (leader's self-reported PROJECT_DIR is unreliable)
  if (projectDir) {
    result.projectDir = projectDir;
  }

  // 3. Override with dev worker preview (ground truth)
  if (teamPreview) {
    if (teamPreview.previewUrl) {
      result.previewUrl = teamPreview.previewUrl;
      result.previewPath = teamPreview.previewPath;
    }
    if (teamPreview.entryFile) result.entryFile = teamPreview.entryFile;
    if (teamPreview.previewCmd) result.previewCmd = teamPreview.previewCmd;
    if (teamPreview.previewPort) result.previewPort = teamPreview.previewPort;
  }

  // 4. Validate entryFile against disk
  validateEntryFile(result, projectDir ?? workspace, workspace);

  // 5. Auto-construct previewCmd for non-HTML entryFile
  autoConstructPreviewCmd(result);

  // 6. Cascading preview URL resolution (only if no preview info yet)
  if (!result.previewUrl && !result.previewPath) {
    resolvePreviewUrlFromTeam(result, ctx);
  }
}

/**
 * Validate entryFile exists on disk. Fall back to changedFiles if not found.
 */
function validateEntryFile(result: TaskResultPayload, projectDir: string, workspace: string): void {
  if (!result.entryFile) return;

  const resolved = resolveAgentPath(result.entryFile, projectDir, workspace);
  if (resolved) {
    result.entryFile = path.relative(projectDir, resolved);
    return;
  }

  // Not found on disk — fall back to changedFiles with matching extension
  const allFiles = result.changedFiles ?? [];
  const ext = path.extname(result.entryFile).toLowerCase();
  const candidate = allFiles
    .map(f => path.basename(f))
    .find(f => path.extname(f).toLowerCase() === ext);

  if (candidate) {
    console.log(`[ResultFinalizer] entryFile "${result.entryFile}" not found, using "${candidate}" from changedFiles`);
    result.entryFile = candidate;
  } else {
    console.log(`[ResultFinalizer] entryFile "${result.entryFile}" not found, clearing`);
    result.entryFile = undefined;
  }
}

/**
 * Auto-construct previewCmd for non-HTML entryFile when no previewCmd was provided.
 */
function autoConstructPreviewCmd(result: TaskResultPayload): void {
  if (!result.entryFile || result.previewCmd || /\.html?$/i.test(result.entryFile)) return;

  const ext = path.extname(result.entryFile).toLowerCase();
  const runner = CONFIG.preview.runners[ext];
  if (runner) {
    result.previewCmd = `${runner} ${result.entryFile}`;
    console.log(`[ResultFinalizer] Auto-constructed previewCmd: ${result.previewCmd}`);
  }
}

/**
 * Team-level preview resolution — first tries worker detection, then falls back
 * to the shared resolvePreview() chain using the leader's result fields.
 */
function resolvePreviewUrlFromTeam(result: TaskResultPayload, ctx: FinalizeContext): void {
  const { projectDir, workspace } = ctx;
  const resolveDir = projectDir ?? workspace;

  // First: scan workers' detectPreview (team-specific, not in shared resolver)
  const workerPreview = ctx.detectWorkerPreview();
  if (workerPreview?.previewUrl || workerPreview?.previewPath) {
    if (workerPreview.previewUrl) result.previewUrl = workerPreview.previewUrl;
    if (workerPreview.previewPath) result.previewPath = workerPreview.previewPath;
    return;
  }

  // Then: use the shared cascading resolver with leader's fields + team changedFiles
  const allChangedFiles = result.changedFiles ?? [];
  const preview = resolvePreview({
    entryFile: result.entryFile,
    previewCmd: result.previewCmd,
    previewPort: result.previewPort,
    changedFiles: allChangedFiles,
    cwd: resolveDir,
    workspace,
  });

  if (preview.previewUrl) result.previewUrl = preview.previewUrl;
  if (preview.previewPath) result.previewPath = preview.previewPath;
}
