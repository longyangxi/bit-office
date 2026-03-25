"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const OfficeSplash = dynamic(() => import("@/components/OfficeSplash"), { ssr: false });

const isTauri = () => typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

/** Connect to a specific gateway port and save the connection info. */
async function connectToPort(port: number): Promise<boolean> {
  const res = await fetch(`http://localhost:${port}/connect`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return false;
  const data = await res.json();
  const { saveConnection } = await import("@/lib/storage");
  saveConnection({
    mode: "ws",
    machineId: data.machineId,
    gatewayId: data.gatewayId,
    wsUrl: `ws://localhost:${port}`,
    role: data.role ?? "owner",
    sessionToken: data.sessionToken,
  });
  return true;
}

export default function PairPage() {
  const [gateway, setGateway] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"connecting" | "failed" | "remote">("connecting");
  const router = useRouter();

  // ── Tauri (production): get port from Rust via command + listen fallback ──
  const waitForTauriGateway = useCallback(async (): Promise<boolean> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // 1. Check if sidecar is already ready (handles race where event fired before listen)
      const stored = await invoke<{ port: number; gatewayId: string } | null>("get_gateway_info");
      if (stored?.port) {
        console.log(`[pair] Tauri get_gateway_info: port=${stored.port}`);
        return connectToPort(stored.port);
      }

      // 2. Not ready yet — listen for the event
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) { settled = true; unlisten?.(); resolve(false); }
          console.log("[pair] Tauri gateway-ready timeout after 30s");
        }, 30_000);

        let unlisten: (() => void) | undefined;
        listen<{ port: number; gatewayId: string }>("gateway-ready", async (event) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          unlisten?.();
          const { port } = event.payload;
          console.log(`[pair] Tauri gateway-ready event: port=${port}`);
          try {
            resolve(await connectToPort(port));
          } catch {
            resolve(false);
          }
        }).then((fn) => { unlisten = fn; });
      });
    } catch {
      return false;
    }
  }, []);

  // ── Web (and Tauri dev): scan known ports to find local gateway ──
  const tryPortScan = useCallback(async (attempt = 0): Promise<boolean> => {
    const maxAttempts = 5;
    const isDev = window.location.port === "3000" || window.location.port === "3002";

    // 1. Same-origin (gateway serves the web bundle in production)
    if (!isDev) {
      try {
        const res = await fetch(`${window.location.origin}/connect`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          const { saveConnection } = await import("@/lib/storage");
          saveConnection({ mode: "ws", machineId: data.machineId, gatewayId: data.gatewayId, wsUrl: window.location.origin.replace(/^http/, "ws"), role: data.role ?? "owner", sessionToken: data.sessionToken });
          return true;
        }
      } catch { /* not bundled mode */ }
    }

    // 2. Scan known ports
    const ports = isDev ? [9099, 9090, 9091] : [9090, 9091, 9099];
    console.log(`[pair] Trying ports [${ports}] (dev=${isDev}, attempt=${attempt + 1}/${maxAttempts})`);
    for (const gwPort of ports) {
      try {
        const res = await fetch(`http://localhost:${gwPort}/connect`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) continue;
        const data = await res.json();
        console.log(`[pair] Connected to gateway on port ${gwPort} (gatewayId=${data.gatewayId})`);
        const { saveConnection } = await import("@/lib/storage");
        saveConnection({ mode: "ws", machineId: data.machineId, gatewayId: data.gatewayId, wsUrl: `ws://localhost:${gwPort}`, role: data.role ?? "owner", sessionToken: data.sessionToken });
        return true;
      } catch { /* try next */ }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1000));
      return tryPortScan(attempt + 1);
    }
    return false;
  }, []);

  /** Pick discovery strategy: Tauri production → IPC; Tauri dev / web → port scan */
  const autoConnect = useCallback(async (): Promise<boolean> => {
    // Tauri dev mode: sidecar not spawned, user runs gateway manually → port scan
    const isDev = window.location.port === "3000" || window.location.port === "3002";
    if (isTauri() && !isDev) {
      return waitForTauriGateway();
    }
    return tryPortScan();
  }, [waitForTauriGateway, tryPortScan]);

  useEffect(() => {
    const startTime = Date.now();
    const minDisplayMs = 3000;

    const navigateAfterDelay = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minDisplayMs - elapsed);
      return new Promise((r) => setTimeout(r, remaining));
    };

    const run = async () => {
      const { getConnection, clearConnection } = require("@/lib/storage");
      const conn = getConnection();

      // Tauri: reject cached connections to wrong gateway and wipe stale UI state
      if (isTauri() && conn?.gatewayId && conn.gatewayId !== "desktop") {
        console.log(`[pair] Cached connection is for gateway ${conn.gatewayId}, need desktop — clearing all state`);
        // Clear scoped storage for the stale gateway (and unscoped legacy keys)
        const staleId = conn.gatewayId;
        clearConnection();
        try {
          for (const base of ["office-chat-history", "office-team-messages", "office-team-phase"]) {
            localStorage.removeItem(base);             // legacy unscoped
            localStorage.removeItem(`${base}:${staleId}`); // scoped
          }
        } catch { /* ignore */ }
      } else if (conn?.sessionToken) {
        await navigateAfterDelay();
        router.push("/office");
        return;
      } else if (conn && !conn.sessionToken) {
        clearConnection();
      }

      const ok = await autoConnect();
      if (ok) {
        await navigateAfterDelay();
        router.push("/office");
      } else {
        setStatus("failed");
      }
    };
    run();
  }, [router, autoConnect]);

  async function handleRetry() {
    setStatus("connecting");
    setError("");
    const ok = await autoConnect();
    if (ok) {
      router.push("/office");
    } else {
      setStatus("failed");
    }
  }

  async function handleRemoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const gatewayUrl = gateway.includes("://") ? gateway : `http://${gateway}`;
      const res = await fetch(`${gatewayUrl}/pair/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to pair");
        return;
      }
      const { saveConnection } = await import("@/lib/storage");
      saveConnection({
        mode: data.hasAbly ? "ably" : "ws",
        machineId: data.machineId,
        wsUrl: data.wsUrl,
        role: data.role ?? "owner",
        sessionToken: data.sessionToken,
      });
      router.push("/office");
    } catch {
      setError("Cannot reach gateway. Check the address.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
      {/* Matrix splash — shown during auto-connect */}
      {status === "connecting" && (
        <OfficeSplash onComplete={() => {}} />
      )}

      {/* Local connection failed */}
      {status === "failed" && (
        <div style={{ textAlign: "center", marginTop: 24, maxWidth: 400 }}>
          <p style={{ color: "#888", fontSize: 14, marginBottom: 20 }}>No local gateway found. Make sure the gateway is running.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={handleRetry}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "2px solid #4f46e5",
                backgroundColor: "transparent", color: "#4f46e5", fontSize: 14, cursor: "pointer",
              }}
            >Retry Local</button>
            <button
              onClick={() => setStatus("remote")}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                backgroundColor: "#333", color: "#aaa", fontSize: 14, cursor: "pointer",
              }}
            >Connect Remote</button>
          </div>
        </div>
      )}

      {/* Remote gateway form */}
      {status === "remote" && (
        <>
          <p style={{ color: "#aaa", marginBottom: 32 }}>Enter your gateway address and pair code</p>
          <form onSubmit={handleRemoteSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 320 }}>
            <label style={{ fontSize: 13, color: "#888" }}>Gateway Address</label>
            <input
              type="text"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              placeholder="your-gateway.com"
              style={{
                fontSize: 16, padding: "12px 16px", borderRadius: 8, border: "2px solid #444",
                backgroundColor: "#222", color: "#fff", marginTop: -8,
              }}
            />
            <label style={{ fontSize: 13, color: "#888" }}>Pair Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PAIR CODE"
              maxLength={6}
              style={{
                fontSize: 32, textAlign: "center", letterSpacing: 8,
                padding: "12px 16px", borderRadius: 8, border: "2px solid #444",
                backgroundColor: "#222", color: "#fff", marginTop: -8,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setStatus("failed")}
                style={{
                  padding: "12px 16px", borderRadius: 8, border: "1px solid #444",
                  backgroundColor: "transparent", color: "#888", fontSize: 14, cursor: "pointer",
                }}
              >Back</button>
              <button
                type="submit"
                disabled={loading || code.length < 6 || !gateway.trim()}
                style={{
                  flex: 1, padding: "12px 24px", borderRadius: 8, border: "none",
                  backgroundColor: code.length >= 6 && gateway.trim() ? "#4f46e5" : "#333",
                  color: "#fff", fontSize: 18, cursor: code.length >= 6 ? "pointer" : "default",
                }}
              >{loading ? "Pairing..." : "Connect"}</button>
            </div>
          </form>
          <button
            onClick={handleRetry}
            style={{ marginTop: 16, background: "none", border: "none", color: "#666", fontSize: 12, cursor: "pointer" }}
          >Retry local connection</button>
        </>
      )}

      {error && <p style={{ color: "#ef4444", textAlign: "center", marginTop: 16 }}>{error}</p>}

      <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { to { transform: rotate(360deg); } }` }} />
    </div>
  );
}
