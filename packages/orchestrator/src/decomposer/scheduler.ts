import type { DecompositionPlan, TaskNode, TaskStatus } from "./types.js";
import { formatLineage, formatSiblings } from "./context.js";

/** Callback the scheduler invokes to dispatch a task */
export type DispatchFn = (task: TaskNode, contextPrompt: string) => void;

/**
 * TaskScheduler — dispatches tasks from a DecompositionPlan in group order.
 *
 * Usage:
 *   const scheduler = new TaskScheduler(plan, dispatch);
 *   scheduler.start(); // dispatches first group
 *   scheduler.taskCompleted("dev-1", "result"); // mark done, auto-advances
 *   scheduler.taskFailed("dev-2", "error"); // mark failed
 */
export class TaskScheduler {
  private plan: DecompositionPlan;
  private dispatch: DispatchFn;
  private currentGroupIndex = 0;
  private taskMap: Map<string, TaskNode>;

  constructor(plan: DecompositionPlan, dispatch: DispatchFn) {
    this.plan = plan;
    this.dispatch = dispatch;
    // Build lookup map from task id to node
    this.taskMap = new Map();
    for (const child of plan.tree.children) {
      this.taskMap.set(child.id, child);
    }
  }

  /** Start executing — dispatches the first group */
  start(): void {
    this.plan.phase = "executing";
    this.plan.tree.status = "running";
    this.dispatchCurrentGroup();
  }

  /** Mark a task as completed */
  taskCompleted(taskId: string, result?: string): void {
    const node = this.taskMap.get(taskId);
    if (!node) return;
    node.status = "done";
    if (result) node.result = result;
    this.checkGroupCompletion();
  }

  /** Mark a task as failed */
  taskFailed(taskId: string, error?: string): void {
    const node = this.taskMap.get(taskId);
    if (!node) return;
    node.status = "failed";
    if (error) node.result = error;
    this.checkGroupCompletion();
  }

  /** Get current plan state */
  getPlan(): DecompositionPlan {
    return this.plan;
  }

  /** Check if all tasks are done/failed */
  isComplete(): boolean {
    return this.plan.phase === "done" || this.currentGroupIndex >= this.plan.groups.length;
  }

  private dispatchCurrentGroup(): void {
    if (this.currentGroupIndex >= this.plan.groups.length) {
      this.finalize();
      return;
    }

    const group = this.plan.groups[this.currentGroupIndex];
    const siblingDescs = group
      .map((id) => this.taskMap.get(id)?.description ?? "")
      .filter(Boolean);

    for (const taskId of group) {
      const node = this.taskMap.get(taskId);
      if (!node) continue;

      node.status = "running";

      // Build context prompt with lineage and siblings
      const parts: string[] = [];
      if (node.lineage.length > 0) {
        parts.push(
          `## Task Hierarchy\n${formatLineage(node.lineage, node.description)}`,
        );
      }
      const otherSiblings = siblingDescs.filter((d) => d !== node.description);
      if (otherSiblings.length > 0) {
        parts.push(
          `## Parallel Work\n${formatSiblings(otherSiblings, node.description)}\n\nDo not duplicate sibling work. If you need interfaces from siblings, define stubs.`,
        );
      }

      this.dispatch(node, parts.join("\n\n"));
    }
  }

  private checkGroupCompletion(): void {
    if (this.currentGroupIndex >= this.plan.groups.length) return;

    const group = this.plan.groups[this.currentGroupIndex];
    const allDone = group.every((id) => {
      const node = this.taskMap.get(id);
      return node && (node.status === "done" || node.status === "failed");
    });

    if (allDone) {
      this.currentGroupIndex++;
      if (this.currentGroupIndex < this.plan.groups.length) {
        this.dispatchCurrentGroup();
      } else {
        this.finalize();
      }
    }
  }

  private finalize(): void {
    // Propagate status up
    const allDone = this.plan.tree.children.every((c) => c.status === "done");
    const anyFailed = this.plan.tree.children.some((c) => c.status === "failed");

    if (allDone) {
      this.plan.tree.status = "done";
      this.plan.phase = "done";
    } else if (anyFailed) {
      this.plan.tree.status = "failed";
      this.plan.phase = "done";
    }
  }
}
