// packages/orchestrator/src/notifier/types.ts

export type NotificationPriority = "urgent" | "action" | "warning" | "info";

export interface Notification {
  title: string;
  message: string;
  priority: NotificationPriority;
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

export interface Notifier {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}
