/**
 * Sync bundled agent definitions to ~/.claude/agents/ on startup.
 * These are curated, compact agent profiles used by Claude Code's --agent flag.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Directory containing our bundled agent .md files (relative to dist/) */
function getBundledAgentsDir(): string {
  // In dist/: ../agents/  (agents/ is sibling to src/)
  const fromDist = resolve(__dirname, "../agents");
  if (existsSync(fromDist)) return fromDist;
  // In src/ during dev: ../agents/
  const fromSrc = resolve(__dirname, "../agents");
  return fromSrc;
}

/** Sync bundled agent definitions to Claude Code's global agents directory */
export function syncAgentDefs(): void {
  const bundledDir = getBundledAgentsDir();
  if (!existsSync(bundledDir)) {
    console.log(`[Agents] No bundled agents directory found at ${bundledDir}`);
    return;
  }

  const targetDir = resolve(homedir(), ".claude", "agents");
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const files = readdirSync(bundledDir).filter(f => f.endsWith(".md"));
  let synced = 0;
  for (const file of files) {
    const src = resolve(bundledDir, file);
    const dst = resolve(targetDir, file);
    try {
      const content = readFileSync(src, "utf-8");
      writeFileSync(dst, content, "utf-8");
      synced++;
    } catch (e) {
      console.warn(`[Agents] Failed to sync ${file}: ${e}`);
    }
  }
  console.log(`[Agents] Synced ${synced} agent definitions to ${targetDir}`);
}
