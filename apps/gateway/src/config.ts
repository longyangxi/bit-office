import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = resolve(homedir(), ".bit-office");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

interface SavedConfig {
  ablyApiKey?: string;
  telegramBotTokens?: (string | null)[];
  detectedBackends?: string[];
  defaultBackend?: string;
  sandboxMode?: "full" | "safe";
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
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
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
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    // Dev mode (pnpm dev:gateway): use .workspace dir to avoid working in source tree
    const ws = resolve(__dirname, "../.workspace");
    if (!existsSync(ws)) {
      mkdirSync(ws, { recursive: true });
      console.log(`[Config] Created default workspace: ${ws}`);
    }
    return ws;
  }
  // Published mode (npx bit-office): use the directory where the user ran the command
  // Tauri sidecar runs with cwd="/", fall back to home directory
  const cwd = process.cwd();
  if (cwd === "/" || cwd === "C:\\") {
    return process.env.HOME || homedir();
  }
  return cwd;
}

function buildConfig() {
  const saved = loadSavedConfig();
  return {
    machineId: getOrCreateMachineId(),
    defaultWorkspace: (() => {
      const envWs = process.env.WORKSPACE;
      if (envWs && existsSync(envWs)) return envWs;
      if (envWs) console.log(`[Config] WORKSPACE="${envWs}" does not exist, using default`);
      return resolveDefaultWorkspace();
    })(),
    wsPort: Number(process.env.WS_PORT) || 9090,
    ablyApiKey: process.env.ABLY_API_KEY || saved.ablyApiKey || undefined,
    webDir: resolveWebDir(),
    telegramBotTokens: (
      process.env.TELEGRAM_BOT_TOKENS
        ? process.env.TELEGRAM_BOT_TOKENS.split(",").map((t) => t.trim() || undefined)
        : (saved.telegramBotTokens ?? []).map((t) => t || undefined)
    ) as (string | undefined)[],
    detectedBackends: saved.detectedBackends ?? [],
    defaultBackend: saved.defaultBackend ?? "claude",
    sandboxMode: (saved.sandboxMode ?? "full") as "full" | "safe",
  };
}

export const config = buildConfig();

/** Reload config from saved file (after setup wizard) */
export function reloadConfig() {
  const fresh = buildConfig();
  Object.assign(config, fresh);
}
