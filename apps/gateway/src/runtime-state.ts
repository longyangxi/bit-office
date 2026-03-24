import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { config } from "./config.js";

export interface GatewayRuntimeState {
  gatewayId: string;
  machineId: string;
  instanceDir: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
}

const RUNTIME_FILE = path.join(config.instanceDir, "runtime.json");
const HEARTBEAT_MS = 15_000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let runtimeState: GatewayRuntimeState | null = null;
let portLockFile: string | null = null;

/** Directory for port-level lock files (shared across all instances) */
const LOCKS_DIR = path.join(path.dirname(config.instanceDir), ".locks");

function portLockPath(port: number): string {
  return path.join(LOCKS_DIR, `port-${port}.pid`);
}

/**
 * Kill any process holding a port lock file.
 * Safer than lsof — the PID in the file is guaranteed to be a gateway we spawned.
 */
function killPortLockHolder(port: number): void {
  const lockFile = portLockPath(port);
  if (!existsSync(lockFile)) return;
  try {
    const pid = parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
    if (!pid || pid === process.pid) return;
    // Check if process is alive
    try { process.kill(pid, 0); } catch {
      console.log(`[Gateway] Stale port lock for :${port} (pid=${pid} already dead), removing`);
      try { unlinkSync(lockFile); } catch { /* ignore */ }
      return;
    }
    console.warn(`[Gateway] Killing orphan gateway on port :${port} (pid=${pid})`);
    killAndWait(pid);
    try { unlinkSync(lockFile); } catch { /* ignore */ }
  } catch {
    try { unlinkSync(lockFile); } catch { /* ignore */ }
  }
}

/** Write a port lock file after successfully binding a port. */
export function writePortLock(port: number): void {
  if (!existsSync(LOCKS_DIR)) mkdirSync(LOCKS_DIR, { recursive: true });
  const lockPath = portLockPath(port);
  writeFileSync(lockPath, String(process.pid), "utf-8");
  portLockFile = lockPath;
  console.log(`[Gateway] Port lock written: ${lockPath} (pid=${process.pid})`);
}

/** Remove the port lock file (called on exit). */
function clearPortLock(): void {
  if (portLockFile) {
    try { unlinkSync(portLockFile); } catch { /* ignore */ }
    portLockFile = null;
  }
}

function writeRuntimeFile(state: GatewayRuntimeState): void {
  const dir = path.dirname(RUNTIME_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${RUNTIME_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, RUNTIME_FILE);
}

function syncSleep(ms: number): void {
  try { execSync(`sleep ${ms / 1000}`, { stdio: "ignore" }); } catch { /* ignore */ }
}

/** Send SIGTERM, wait up to 2s, then SIGKILL if still alive. */
function killAndWait(pid: number): void {
  // Check if process is alive
  try { process.kill(pid, 0); } catch { return; }

  console.warn(`[Gateway] Killing previous instance (pid=${pid})`);
  process.kill(pid, "SIGTERM");

  for (let i = 0; i < 20; i++) {
    syncSleep(100);
    try { process.kill(pid, 0); } catch {
      console.log(`[Gateway] Previous instance (pid=${pid}) exited gracefully`);
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
    console.warn(`[Gateway] Previous instance (pid=${pid}) force-killed`);
  } catch { /* already dead */ }
}

/**
 * Kill any previous gateway instances — checks ALL instance dirs,
 * not just the current one, to catch orphans from other instance IDs
 * (e.g. port-9099 orphan when desktop starts).
 */
export function killPreviousInstances(): void {
  const instancesDir = path.dirname(config.instanceDir);
  let dirs: string[];
  try {
    dirs = readdirSync(instancesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(instancesDir, d.name));
  } catch {
    dirs = [config.instanceDir];
  }

  for (const dir of dirs) {
    const runtimeFile = path.join(dir, "runtime.json");
    if (!existsSync(runtimeFile)) continue;
    try {
      const prev: GatewayRuntimeState = JSON.parse(readFileSync(runtimeFile, "utf-8"));
      if (prev.pid === process.pid) continue;
      // Check if process is alive
      try { process.kill(prev.pid, 0); } catch {
        console.log(`[Gateway] Stale runtime.json in ${path.basename(dir)} (pid=${prev.pid} already dead), cleaning up`);
        try { unlinkSync(runtimeFile); } catch { /* ignore */ }
        continue;
      }
      // Guard against PID reuse: if the last heartbeat is too old (>60s),
      // the PID was reused by a different process — don't kill it.
      const heartbeatAge = Date.now() - (prev.heartbeatAt || 0);
      if (heartbeatAge > 60_000) {
        console.log(`[Gateway] runtime.json in ${path.basename(dir)} has stale heartbeat (${Math.round(heartbeatAge / 1000)}s ago) but pid=${prev.pid} is alive — PID reuse, skipping`);
        try { unlinkSync(runtimeFile); } catch { /* ignore */ }
        continue;
      }
      killAndWait(prev.pid);
      try { unlinkSync(runtimeFile); } catch { /* ignore */ }
    } catch {
      try { unlinkSync(runtimeFile); } catch { /* ignore */ }
    }
  }

  // Phase 2: Kill orphans via port lock files (catches zombies whose runtime.json was lost)
  const targetPort = config.wsPort;
  for (let p = targetPort; p < targetPort + 10; p++) {
    killPortLockHolder(p);
  }
}

export function registerRuntimeState(): GatewayRuntimeState {
  runtimeState = {
    gatewayId: config.gatewayId,
    machineId: config.machineId,
    instanceDir: config.instanceDir,
    pid: process.pid,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
  };
  writeRuntimeFile(runtimeState);
  heartbeatTimer = setInterval(() => {
    if (!runtimeState) return;
    runtimeState.heartbeatAt = Date.now();
    try {
      writeRuntimeFile(runtimeState);
    } catch { /* ignore */ }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
  return runtimeState;
}

export function clearRuntimeState(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  runtimeState = null;
  try {
    unlinkSync(RUNTIME_FILE);
  } catch { /* ignore */ }
  clearPortLock();
}
