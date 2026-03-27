import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceInfo, PostCreateConfig } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Run post-creation hooks: symlinks from main repo + shell commands.
 * Errors are logged but never thrown — workspace creation should not fail
 * because of a postCreate issue. The agent will fail on its own and the
 * ReactionEngine handles retry/escalation.
 */
export async function runPostCreate(
  info: WorkspaceInfo,
  repoRoot: string,
  config: PostCreateConfig,
): Promise<void> {
  // Symlinks
  if (config.symlinks) {
    for (const symlinkPath of config.symlinks) {
      // Security: reject absolute paths and directory traversal
      if (symlinkPath.startsWith("/") || symlinkPath.includes("..")) {
        console.warn(`[Workspace postCreate] Rejected symlink "${symlinkPath}": must be relative without ".." segments`);
        continue;
      }

      const sourcePath = join(repoRoot, symlinkPath);
      const targetPath = resolve(info.path, symlinkPath);

      // Security: verify resolved path stays within workspace
      if (!targetPath.startsWith(info.path + "/") && targetPath !== info.path) {
        console.warn(`[Workspace postCreate] Rejected symlink "${symlinkPath}": resolves outside workspace`);
        continue;
      }

      if (!existsSync(sourcePath)) continue;

      // Remove existing target if present
      try {
        const stat = lstatSync(targetPath);
        if (stat.isSymbolicLink() || stat.isFile() || stat.isDirectory()) {
          rmSync(targetPath, { recursive: true, force: true });
        }
      } catch {
        // Target doesn't exist — that's fine
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      try {
        symlinkSync(sourcePath, targetPath);
      } catch (err) {
        console.warn(`[Workspace postCreate] Failed to symlink ${symlinkPath}: ${(err as Error).message}`);
      }
    }
  }

  // Commands
  if (config.commands) {
    for (const command of config.commands) {
      try {
        await execFileAsync("sh", ["-c", command], { cwd: info.path, timeout: 120_000 });
      } catch (err) {
        console.warn(`[Workspace postCreate] Command failed: "${command}": ${(err as Error).message}`);
        // Continue — don't fail workspace creation
      }
    }
  }
}
