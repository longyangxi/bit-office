import type { ConnectionInfo } from "./storage";
import { connectToWs, sendWsCommand, disconnectWs } from "./ws-client";

// Ably transport is registered lazily at runtime (see useAblyLoader hook)
// to prevent SSR from pulling in ably-node.js and its unresolvable dependencies.
interface AblyTransport {
  connect(machineId: string, sessionToken?: string): Promise<void>;
  send(command: Record<string, unknown>): void;
  disconnect(): void;
}
let ablyTransport: AblyTransport | null = null;

export function registerAblyTransport(transport: AblyTransport) {
  ablyTransport = transport;
}

let activeMode: "ws" | "ably" | null = null;
let connectionId = 0;

export function connect(info: ConnectionInfo) {
  disconnect();
  const id = ++connectionId;

  if (info.mode === "ws" && info.wsUrl) {
    activeMode = "ws";
    connectToWs(info.wsUrl, info.sessionToken);
  } else if (info.mode === "ably") {
    activeMode = "ably";
    if (ablyTransport) {
      ablyTransport.connect(info.machineId, info.sessionToken).catch(console.error);
    } else {
      console.error("[Connection] Ably transport not registered");
    }
  }

  // Return a scoped disconnect — only disconnects if this connection is still active
  return () => {
    if (connectionId === id) {
      disconnect();
    }
  };
}

export function sendCommand(command: Record<string, unknown>) {
  if (activeMode === "ws") {
    sendWsCommand(command);
  } else if (activeMode === "ably") {
    ablyTransport?.send(command);
  } else {
    // Fallback: try WS anyway (ws-client checks readyState internally)
    console.warn("[Connection] No active transport, attempting WS fallback");
    sendWsCommand(command);
  }
}

export function disconnect() {
  if (activeMode === "ws") {
    disconnectWs();
  } else if (activeMode === "ably") {
    ablyTransport?.disconnect();
  }
  activeMode = null;
}
