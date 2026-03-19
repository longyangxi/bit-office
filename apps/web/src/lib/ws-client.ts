import { GatewayEventSchema } from "@office/shared";
import { useOfficeStore } from "@/store/office-store";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentUrl: string | null = null;
let currentSessionToken: string | null = null;

// Exponential backoff state
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
let reconnectDelay = RECONNECT_BASE_MS;

export function connectToWs(wsUrl: string, sessionToken?: string) {
  // Clean up any existing connection first
  cleanup();
  currentUrl = wsUrl;
  currentSessionToken = sessionToken ?? null;
  reconnectDelay = RECONNECT_BASE_MS; // reset backoff on fresh connect
  doConnect();
}

function cleanup() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    // Remove handlers so close event doesn't trigger reconnect
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

function doConnect() {
  if (!currentUrl) return;

  const socket = new WebSocket(currentUrl);

  socket.onopen = () => {
    console.log("[WS] Connected");
    // Reset backoff on successful connection
    reconnectDelay = RECONNECT_BASE_MS;
    // Send AUTH handshake first
    if (socket.readyState === WebSocket.OPEN && currentSessionToken) {
      socket.send(JSON.stringify({ type: "AUTH", sessionToken: currentSessionToken }));
    }
    useOfficeStore.getState().setConnected(true);
    // Send PING to get current agent statuses
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
  };

  socket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      // Handle AUTH_FAILED: clear stale connection, redirect to re-pair
      if (msg.type === "AUTH_FAILED") {
        console.log("[WS] AUTH_FAILED — clearing connection and redirecting to /pair");
        cleanup();
        currentUrl = null;
        const { clearConnection } = require("@/lib/storage");
        clearConnection();
        window.location.href = "/pair";
        return;
      }
      const event = GatewayEventSchema.parse(msg);
      useOfficeStore.getState().handleEvent(event);
    } catch (err) {
      console.error("[WS] Invalid event:", err);
    }
  };

  socket.onclose = () => {
    console.log("[WS] Disconnected");
    useOfficeStore.getState().setConnected(false);
    // Only reconnect if this is still the active socket
    if (ws === socket && currentUrl) {
      ws = null;
      console.log(`[WS] Reconnecting in ${reconnectDelay}ms...`);
      reconnectTimer = setTimeout(doConnect, reconnectDelay);
      // Exponential backoff: 2s → 3s → 4.5s → ... → 30s max
      reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_MS);
    }
  };

  socket.onerror = () => {
    // Error is always followed by close, so just let onclose handle reconnect
  };

  ws = socket;
}

export function sendWsCommand(command: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[WS] Not connected, dropping command:", command.type);
    return;
  }
  console.log("[WS] Sending command:", command.type, command);
  ws.send(JSON.stringify(command));
}

export function disconnectWs() {
  currentUrl = null;
  cleanup();
}
