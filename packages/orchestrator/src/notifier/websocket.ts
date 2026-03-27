// packages/orchestrator/src/notifier/websocket.ts

import type { Notifier, OrchestratorNotification } from "./types.js";

/**
 * WebSocket notifier — emits notifications as orchestrator events.
 * Gateway forwards them to WebSocket/Ably clients automatically.
 * Zero config — this is the default notifier.
 */
export function createWebSocketNotifier(
  emitEvent: (event: Record<string, unknown>) => void,
): Notifier {
  return {
    name: "websocket",
    async send(notification: OrchestratorNotification): Promise<void> {
      emitEvent({
        type: "notification",
        ...notification,
      });
    },
  };
}
