import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StuckDetector } from "../stuck-detector.js";

describe("StuckDetector", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires callback for agents idle beyond threshold", () => {
    const onStuck = vi.fn();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: Date.now() - 6000, taskId: "t1" },
      ],
      onStuck,
    });
    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledWith("a1", "t1");
    detector.stop();
  });

  it("does not fire for recently active agents", () => {
    const onStuck = vi.fn();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: Date.now() - 1000, taskId: "t1" },
      ],
      onStuck,
    });
    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).not.toHaveBeenCalled();
    detector.stop();
  });

  it("does not fire twice without new activity", () => {
    const onStuck = vi.fn();
    const now = Date.now();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: now - 6000, taskId: "t1" },
      ],
      onStuck,
    });
    detector.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(1);
    detector.stop();
  });

  it("re-fires after agent becomes active then stuck again", () => {
    const onStuck = vi.fn();
    let lastOutput = Date.now() - 6000;
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: lastOutput, taskId: "t1" },
      ],
      onStuck,
    });
    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(1);
    // Agent becomes active
    lastOutput = Date.now();
    vi.advanceTimersByTime(1000);
    // Goes stuck again
    lastOutput = Date.now() - 6000;
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(2);
    detector.stop();
  });
});
