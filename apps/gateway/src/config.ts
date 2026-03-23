import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";
export const CONFIG_DIR = resolve(homedir(), isDev ? ".open-office-dev" : ".open-office");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");


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
  autoMergeEnabled?: boolean;
  tunnelBaseUrl?: string;
  tunnelToken?: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
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

function ensureGitRepo(dir: string) {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: dir, stdio: "ignore", timeout: 3000 });
  } catch {
    try {
      execSync("git init", { cwd: dir, stdio: "pipe", timeout: 3000 });
      execSync('git -c user.name=OpenOffice -c user.email=bot@open-office.local commit --allow-empty -m init', { cwd: dir, stdio: "pipe", timeout: 3000 });
      console.log(`[Config] Initialized git repo in ${dir}`);
    } catch { /* ignore */ }
  }
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
    ensureGitRepo(ws);
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
    ensureGitRepo(ws);
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
    autoMergeEnabled: saved.autoMergeEnabled ?? true,
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
