import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
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

function writeRuntimeFile(state: GatewayRuntimeState): void {
  const dir = path.dirname(RUNTIME_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${RUNTIME_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, RUNTIME_FILE);
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
}
