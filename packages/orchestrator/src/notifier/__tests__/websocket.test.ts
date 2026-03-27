import { describe, it, expect, vi } from "vitest";
import { createWebSocketNotifier } from "../websocket.js";

describe("createWebSocketNotifier", () => {
  it("emits notification event via callback", async () => {
    const emitEvent = vi.fn();
    const notifier = createWebSocketNotifier(emitEvent);
    await notifier.send({
      title: "Test",
      message: "Hello",
      priority: "info",
    });
    expect(emitEvent).toHaveBeenCalledWith({
      type: "notification",
      title: "Test",
      message: "Hello",
      priority: "info",
    });
  });

  it("has name 'websocket'", () => {
    const notifier = createWebSocketNotifier(vi.fn());
    expect(notifier.name).toBe("websocket");
  });
});
