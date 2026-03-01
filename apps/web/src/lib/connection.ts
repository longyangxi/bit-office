import type { ConnectionInfo } from "./storage";
import { connectToAbly, sendCommand as ablySend, disconnectAbly } from "./ably-client";
import { connectToWs, sendWsCommand, disconnectWs } from "./ws-client";

let activeMode: "ws" | "ably" | null = null;
let connectionId = 0;

export function connect(info: ConnectionInfo) {
  disconnect();
  const id = ++connectionId;

  if (info.mode === "ws" && info.wsUrl) {
    activeMode = "ws";
    connectToWs(info.wsUrl);
  } else if (info.mode === "ably") {
    activeMode = "ably";
    connectToAbly(info.machineId);
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
    ablySend(command);
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
    disconnectAbly();
  }
  activeMode = null;
}
