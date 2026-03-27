import { describe, it, expect, vi } from "vitest";
import { TaskScheduler } from "../scheduler.js";
import type { DecompositionPlan, TaskNode } from "../types.js";

function makePlan(overrides?: Partial<DecompositionPlan>): DecompositionPlan {
  return {
    id: "plan-1",
    rootTask: "Build snake game",
    groups: [["dev-1", "dev-2"], ["review-1"]],
    phase: "approved",
    tree: {
      id: "root",
      parentId: null,
      description: "Build snake game",
      kind: "composite",
      status: "pending",
      depth: 0,
      lineage: [],
      children: [
        { id: "dev-1", parentId: "root", description: "Implement movement", role: "Developer", kind: "atomic", status: "pending", depth: 1, lineage: ["Build snake game"], children: [] },
        { id: "dev-2", parentId: "root", description: "Add collision", role: "Developer", kind: "atomic", status: "pending", depth: 1, lineage: ["Build snake game"], children: [] },
        { id: "review-1", parentId: "root", description: "Review code", role: "Code Reviewer", kind: "atomic", status: "pending", depth: 1, lineage: ["Build snake game"], children: [] },
      ],
    },
    ...overrides,
  };
}

describe("TaskScheduler", () => {
  it("dispatches first group on start", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].id).toBe("dev-1");
    expect(dispatch.mock.calls[1][0].id).toBe("dev-2");
  });

  it("does not dispatch second group until first completes", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    scheduler.taskCompleted("dev-1");
    expect(dispatch).toHaveBeenCalledTimes(2); // still only first group

    scheduler.taskCompleted("dev-2");
    expect(dispatch).toHaveBeenCalledTimes(3); // now second group dispatched
    expect(dispatch.mock.calls[2][0].id).toBe("review-1");
  });

  it("includes lineage context in dispatch", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    const contextPrompt = dispatch.mock.calls[0][1] as string;
    expect(contextPrompt).toContain("Task Hierarchy");
    expect(contextPrompt).toContain("Build snake game");
    expect(contextPrompt).toContain("<-- (this task)");
  });

  it("includes sibling context for parallel tasks", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    const contextPrompt = dispatch.mock.calls[0][1] as string;
    expect(contextPrompt).toContain("Parallel Work");
    expect(contextPrompt).toContain("Add collision");
  });

  it("finalizes plan when all groups complete", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    scheduler.taskCompleted("dev-1", "done");
    scheduler.taskCompleted("dev-2", "done");
    scheduler.taskCompleted("review-1", "passed");

    expect(scheduler.isComplete()).toBe(true);
    expect(scheduler.getPlan().phase).toBe("done");
    expect(scheduler.getPlan().tree.status).toBe("done");
  });

  it("marks plan as failed if any task fails", () => {
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(makePlan(), dispatch);
    scheduler.start();

    scheduler.taskCompleted("dev-1");
    scheduler.taskFailed("dev-2", "build error");
    // Group completes (all done/failed), advances to next
    scheduler.taskCompleted("review-1");

    expect(scheduler.isComplete()).toBe(true);
    expect(scheduler.getPlan().tree.status).toBe("failed");
  });

  it("handles single-group plan", () => {
    const plan = makePlan({ groups: [["dev-1", "dev-2", "review-1"]] });
    const dispatch = vi.fn();
    const scheduler = new TaskScheduler(plan, dispatch);
    scheduler.start();

    expect(dispatch).toHaveBeenCalledTimes(3);
    scheduler.taskCompleted("dev-1");
    scheduler.taskCompleted("dev-2");
    scheduler.taskCompleted("review-1");
    expect(scheduler.isComplete()).toBe(true);
  });
});
