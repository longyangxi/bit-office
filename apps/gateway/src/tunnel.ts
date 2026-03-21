// ---------------------------------------------------------------------------
// Cloudflare Tunnel manager — auto-starts `cloudflared` when token is configured.
//
// Usage:
//   config.json: { "tunnelToken": "eyJ...", "tunnelBaseUrl": "https://openoffice.longames.com" }
//   env:         TUNNEL_TOKEN=eyJ...  TUNNEL_BASE_URL=https://openoffice.longames.com
// ---------------------------------------------------------------------------

import { spawn, execFileSync } from "child_process";
import type { ChildProcess } from "child_process";
import { config } from "./config.js";

let tunnelProcess: ChildProcess | null = null;

function isCloudflaredInstalled(): boolean {
  try {
    execFileSync("cloudflared", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the cloudflared tunnel if token is configured.
 * Spawns as a detached child so it doesn't block the gateway event loop.
 */
export function startTunnel(): boolean {
  if (!config.tunnelToken) {
    return false;
  }

  if (tunnelProcess) {
    console.log("[Tunnel] Already running, skipping start");
    return true;
  }

  if (!isCloudflaredInstalled()) {
    console.error("[Tunnel] cloudflared is not installed. Install it: brew install cloudflared");
    return false;
  }

  try {
    tunnelProcess = spawn("cloudflared", ["tunnel", "run", "--token", config.tunnelToken], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    tunnelProcess.stdout?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Tunnel] ${msg.slice(0, 200)}`);
    });

    tunnelProcess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      // cloudflared logs to stderr by default — filter noise
      if (msg && !msg.includes("INF")) {
        console.log(`[Tunnel] ${msg.slice(0, 200)}`);
      }
    });

    tunnelProcess.on("exit", (code) => {
      console.log(`[Tunnel] cloudflared exited with code ${code}`);
      tunnelProcess = null;
    });

    tunnelProcess.unref();

    const baseUrl = config.tunnelBaseUrl ?? "(not configured)";
    console.log(`[Tunnel] Started cloudflared (pid=${tunnelProcess.pid}), public URL: ${baseUrl}`);
    return true;
  } catch (err) {
    console.error("[Tunnel] Failed to start cloudflared:", err);
    return false;
  }
}

/**
 * Stop the cloudflared tunnel process.
 */
export function stopTunnel(): void {
  if (!tunnelProcess) return;
  try {
    if (tunnelProcess.pid) {
      process.kill(-tunnelProcess.pid, "SIGTERM");
    } else {
      tunnelProcess.kill("SIGTERM");
    }
  } catch {
    try { tunnelProcess.kill("SIGTERM"); } catch { /* already dead */ }
  }
  console.log("[Tunnel] Stopped cloudflared");
  tunnelProcess = null;
}

/**
 * Check if the tunnel is currently running.
 */
export function isTunnelRunning(): boolean {
  return tunnelProcess !== null;
}
