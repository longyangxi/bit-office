export { createWebSocketNotifier } from "./websocket.js";
export type { Notifier, OrchestratorNotification, NotificationPriority } from "./types.js";
/** @deprecated Use OrchestratorNotification instead (avoids DOM Notification collision) */
export type { OrchestratorNotification as Notification } from "./types.js";
