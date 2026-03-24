const CONNECTION_KEY = "office_connection";

export interface ConnectionInfo {
  mode: "ws" | "ably";
  machineId: string;
  gatewayId?: string;
  wsUrl?: string;
  role?: "owner" | "collaborator" | "spectator";
  sessionToken?: string;
}

export function saveConnection(info: ConnectionInfo) {
  // Use sessionStorage so each tab keeps its own identity (owner vs collaborator vs spectator).
  // Fall back to localStorage for the owner connection so it persists across new tabs.
  sessionStorage.setItem(CONNECTION_KEY, JSON.stringify(info));
  if (info.role === "owner" || !info.role) {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(info));
  }
}

export function getConnection(): ConnectionInfo | null {
  // Prefer sessionStorage (tab-specific), fall back to localStorage (owner persisted)
  const raw = sessionStorage.getItem(CONNECTION_KEY) ?? localStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConnectionInfo;
  } catch {
    return null;
  }
}

export function clearConnection() {
  sessionStorage.removeItem(CONNECTION_KEY);
  localStorage.removeItem(CONNECTION_KEY);
}

/** Derive Gateway HTTP URL from stored wsUrl (ws://host:port → http://host:port) or use current origin */
export function getGatewayHttpUrl(): string {
  const conn = getConnection();
  if (conn?.wsUrl) {
    return conn.wsUrl.replace(/^ws(s?):\/\//, "http$1://");
  }
  return window.location.origin;
}
