import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";
export const CONFIG_DIR = resolve(homedir(), isDev ? ".open-office-dev" : ".open-office");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

// Migrate from legacy ~/.bit-office[-dev] to ~/.open-office[-dev]
const LEGACY_DIR = resolve(homedir(), isDev ? ".bit-office-dev" : ".bit-office");
// Also handle the case where dev never had a separate dir (old layout used .bit-office for both)
const LEGACY_SHARED_DIR = resolve(homedir(), ".bit-office");

interface SavedConfig {
  ablyApiKey?: string;
  /** @deprecated Use telegramBotToken (singular) */
  telegramBotTokens?: (string | null)[];
  telegramBotToken?: string;
  telegramAllowedUsers?: string[];
  detectedBackends?: string[];
  defaultBackend?: string;
  sandboxMode?: "full" | "safe";
  worktreeEnabled?: boolean;
  tunnelBaseUrl?: string;
  tunnelToken?: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Migrate from legacy ~/.bit-office to ~/.open-office[-dev] with organized layout.
 */
function migrateDirectoryLayout() {
  // Step 1: Rename ~/.bit-office → ~/.open-office[-dev] if needed
  const legacySource = existsSync(LEGACY_DIR) ? LEGACY_DIR
    : (existsSync(LEGACY_SHARED_DIR) && LEGACY_SHARED_DIR !== CONFIG_DIR) ? LEGACY_SHARED_DIR
    : null;
  if (legacySource && !existsSync(CONFIG_DIR)) {
    renameSync(legacySource, CONFIG_DIR);
    console.log(`[Config] Renamed ${legacySource} → ${CONFIG_DIR}`);
  }

  // Step 2: Reorganize internal layout
  const dataDir = resolve(CONFIG_DIR, "data");
  // Order matters: move "projects" (history JSONs) before renaming "workspace" → "projects"
  const moves: [string, string][] = [
    [resolve(CONFIG_DIR, "projects"), resolve(dataDir, "project-history")],
    [resolve(CONFIG_DIR, "instances"), resolve(dataDir, "instances")],
    [resolve(CONFIG_DIR, "memory"), resolve(dataDir, "memory")],
    [resolve(CONFIG_DIR, "prompts"), resolve(dataDir, "prompts")],
    [resolve(CONFIG_DIR, "agents.json"), resolve(dataDir, "agents.json")],
    [resolve(CONFIG_DIR, "workspace"), resolve(CONFIG_DIR, "projects")],
  ];
  let migrated = false;
  for (const [from, to] of moves) {
    if (existsSync(from) && !existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      migrated = true;
    }
  }
  // Remove legacy root-level state files (now instance-scoped under data/instances/)
  const legacyFiles = ["agent-sessions.json", "session-tokens.json", "team-state.json", "project-events.jsonl"];
  for (const file of legacyFiles) {
    const p = resolve(CONFIG_DIR, file);
    if (existsSync(p)) {
      try { unlinkSync(p); migrated = true; } catch { /* ignore */ }
    }
  }
  if (migrated) console.log("[Config] Migrated directory layout to new structure");
}

function loadSavedConfig(): SavedConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfig(cfg: SavedConfig) {
  ensureConfigDir();
  const existing = loadSavedConfig();
  const merged = { ...existing, ...cfg };
  // Remove keys explicitly set to undefined (e.g. clearing legacy fields)
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete (merged as Record<string, unknown>)[k];
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

export function hasSetupRun(): boolean {
  return existsSync(CONFIG_FILE);
}

function getOrCreateMachineId(): string {
  ensureConfigDir();
  const idFile = resolve(CONFIG_DIR, "machine-id");

  if (existsSync(idFile)) {
    return readFileSync(idFile, "utf-8").trim();
  }

  const id = `mac-${randomBytes(4).toString("hex")}`;
  writeFileSync(idFile, id, "utf-8");
  console.log(`[Config] Generated machine ID: ${id}`);
  return id;
}

function resolveWebDir(): string {
  if (process.env.WEB_DIR) return process.env.WEB_DIR;
  // Bundled mode: dist/web (next to dist/index.js)
  const bundled = resolve(__dirname, "web");
  if (existsSync(resolve(bundled, "index.html"))) return bundled;
  // Dev mode: apps/web/out (relative to apps/gateway/src/)
  return resolve(__dirname, "../../web/out");
}

function resolveDefaultWorkspace(): string {
  if (isDev) {
    // Dev mode: use ~/.open-office-dev/projects/ (outside git repo so Claude Code
    // doesn't resolve to the source tree as its working directory)
    const ws = resolve(CONFIG_DIR, "projects");
    if (!existsSync(ws)) {
      mkdirSync(ws, { recursive: true });
      console.log(`[Config] Created default workspace: ${ws}`);
    }
    return ws;
  }
  // Published mode: use the directory where the user ran the command
  // Tauri sidecar runs with cwd="/", fall back to ~/.open-office/projects/
  const cwd = process.cwd();
  if (cwd === "/" || cwd === "C:\\") {
    const ws = resolve(CONFIG_DIR, "projects");
    if (!existsSync(ws)) {
      mkdirSync(ws, { recursive: true });
      console.log(`[Config] Created default workspace: ${ws}`);
    }
    return ws;
  }
  return cwd;
}

/**
 * Resolve a stable gateway instance ID.
 * - GATEWAY_ID env var takes precedence (e.g. Tauri sets "desktop")
 * - Falls back to "port-{wsPort}" so different ports auto-isolate
 *
 * Each gateway instance gets its own state directory under
 * ~/.open-office[-dev]/data/instances/{gatewayId}/ to prevent cross-instance
 * context contamination (e.g. Tauri vs Web vs CLI all running separately).
 */
function resolveGatewayId(): string {
  if (process.env.GATEWAY_ID) return process.env.GATEWAY_ID;
  const port = Number(process.env.WS_PORT) || 9090;
  return `port-${port}`;
}

function resolveInstanceDir(gatewayId: string): string {
  const dir = resolve(CONFIG_DIR, "data", "instances", gatewayId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function buildConfig() {
  ensureConfigDir();
  migrateDirectoryLayout();
  const saved = loadSavedConfig();
  const gatewayId = resolveGatewayId();
  const instanceDir = resolveInstanceDir(gatewayId);
  return {
    machineId: getOrCreateMachineId(),
    /** Unique identifier for this gateway instance (isolates state from other instances) */
    gatewayId,
    /** Per-instance state directory: ~/.open-office[-dev]/data/instances/{gatewayId}/ */
    instanceDir,
    defaultWorkspace: (() => {
      const envWs = process.env.WORKSPACE;
      if (envWs && existsSync(envWs)) return envWs;
      if (envWs) console.log(`[Config] WORKSPACE="${envWs}" does not exist, using default`);
      return resolveDefaultWorkspace();
    })(),
    wsPort: Number(process.env.WS_PORT) || 9090,
    ablyApiKey: process.env.ABLY_API_KEY || saved.ablyApiKey || undefined,
    webDir: resolveWebDir(),
    telegramBotToken:
      process.env.TELEGRAM_BOT_TOKEN
      || saved.telegramBotToken
      || (process.env.TELEGRAM_BOT_TOKENS?.split(",")[0]?.trim())
      || (saved.telegramBotTokens?.[0] ?? undefined)
      || undefined,
    telegramAllowedUsers: (
      process.env.TELEGRAM_ALLOWED_USERS
        ? process.env.TELEGRAM_ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean)
        : saved.telegramAllowedUsers ?? []
    ),
    detectedBackends: saved.detectedBackends ?? [],
    defaultBackend: saved.defaultBackend ?? "claude",
    sandboxMode: (saved.sandboxMode ?? "full") as "full" | "safe",
    worktreeEnabled: saved.worktreeEnabled ?? true,
    tunnelBaseUrl: (process.env.TUNNEL_BASE_URL || saved.tunnelBaseUrl || "").replace(/\/+$/, "") || undefined,
    tunnelToken: process.env.TUNNEL_TOKEN || saved.tunnelToken || undefined,
  };
}

export const config = buildConfig();

/** Reload config from saved file (after setup wizard) */
export function reloadConfig() {
  const fresh = buildConfig();
  Object.assign(config, fresh);
}
