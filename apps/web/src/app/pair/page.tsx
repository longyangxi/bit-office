"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PairPage() {
  const [gateway, setGateway] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const router = useRouter();

  // On mount: check saved connection, then try auto-connect
  useEffect(() => {
    const { getConnection } = require("@/lib/storage");
    const conn = getConnection();
    if (conn && conn.sessionToken) {
      router.push("/office");
      return;
    }
    // Clear stale connection without sessionToken (pre-RBAC)
    if (conn && !conn.sessionToken) {
      const { clearConnection } = require("@/lib/storage");
      clearConnection();
    }
    tryAutoConnect();
  }, [router]);

  async function tryAutoConnect(attempt = 0) {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    const maxAttempts = isTauri ? 10 : 1; // Tauri: retry up to 10 times (gateway may still be starting)

    // 1. Production: try same-origin (gateway serves the web bundle)
    if (window.location.port !== "3000" && window.location.port !== "3002") {
      try {
        const res = await fetch(`${window.location.origin}/connect`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          const { saveConnection } = await import("@/lib/storage");
          saveConnection({ mode: "ws", machineId: data.machineId, wsUrl: window.location.origin.replace(/^http/, "ws"), role: data.role ?? "owner", sessionToken: data.sessionToken });
          router.push("/office");
          return;
        }
      } catch { /* not bundled mode */ }
    }

    // 2. Scan gateway port range (9090–9099, matching gateway auto-retry)
    const BASE_PORT = 9090;
    const PORT_RANGE = 10;
    const timeout = isTauri ? 2000 : 500;
    console.log(`[pair] Scanning localhost:${BASE_PORT}-${BASE_PORT + PORT_RANGE - 1} (tauri=${isTauri}, timeout=${timeout}ms, attempt=${attempt})`);
    for (let port = BASE_PORT; port < BASE_PORT + PORT_RANGE; port++) {
      try {
        const origin = `http://localhost:${port}`;
        const res = await fetch(`${origin}/connect`, { signal: AbortSignal.timeout(timeout) });
        if (!res.ok) continue;
        const data = await res.json();
        console.log(`[pair] Connected to gateway on port ${port}`);
        const { saveConnection } = await import("@/lib/storage");
        saveConnection({ mode: "ws", machineId: data.machineId, wsUrl: `ws://localhost:${port}`, role: data.role ?? "owner", sessionToken: data.sessionToken });
        router.push("/office");
        return;
      } catch (err) {
        console.log(`[pair] Port ${port} failed:`, (err as Error).message);
      }
    }

    // Retry for Tauri (gateway sidecar may need time to start)
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1000));
      return tryAutoConnect(attempt + 1);
    }

    // No local gateway found — show pair code form (remote mode)
    setShowPair(true);
  }

  async function handleSubmit(e: React.FormEvent) {
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
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Bit Office</h1>

      {/* Auto-connecting spinner */}
      {!showPair && (
        <p style={{ color: "#666", fontSize: 14 }}>Connecting...</p>
      )}

      {/* Remote mode: pair code form */}
      {showPair && (
        <>
          <p style={{ color: "#aaa", marginBottom: 32 }}>Enter your gateway address and pair code</p>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 320 }}>
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
            <button
              type="submit"
              disabled={loading || code.length < 6 || !gateway.trim()}
              style={{
                padding: "12px 24px", borderRadius: 8, border: "none",
                backgroundColor: code.length >= 6 && gateway.trim() ? "#4f46e5" : "#333",
                color: "#fff", fontSize: 18, cursor: code.length >= 6 ? "pointer" : "default",
              }}
            >
              {loading ? "Pairing..." : "Connect"}
            </button>
          </form>
        </>
      )}

      {error && <p style={{ color: "#ef4444", textAlign: "center", marginTop: 16 }}>{error}</p>}
    </div>
  );
}
