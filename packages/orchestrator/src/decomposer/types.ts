// packages/orchestrator/src/decomposer/types.ts

/** Task classification */
export type TaskKind = "atomic" | "composite";

/** Task lifecycle status */
export type TaskStatus = "pending" | "running" | "done" | "failed";

/**
 * A node in the decomposition tree.
 * Leaf nodes are dispatched to worker agents.
 */
export interface TaskNode {
  /** Hierarchical ID: "1", "1.2", "1.2.3" */
  id: string;
  /** Explicit parent reference (null for root) */
  parentId: string | null;
  /** Task description */
  description: string;
  /** Target role: "Developer", "Code Reviewer" */
  role?: string;
  /** Atomic = single agent can handle; composite = needs sub-decomposition */
  kind: TaskKind;
  /** Current lifecycle status */
  status: TaskStatus;
  /** Depth in the tree (root = 0) */
  depth: number;
  /** Ancestor descriptions from root to parent (for context injection) */
  lineage: string[];
  /** Child tasks (empty for atomic leaves) */
  children: TaskNode[];
  /** Agent ID assigned to this task */
  assignedTo?: string;
  /** Result summary after completion */
  result?: string;
}

/**
 * A decomposition plan — the full tree of tasks produced by
 * either the Leader's [DECOMPOSITION] block or the LLM decomposer.
 */
export interface DecompositionPlan {
  id: string;
  rootTask: string;
  tree: TaskNode;
  /** Execution groups — each group runs sequentially, tasks within a group run concurrently */
  groups: string[][];
  phase: "planning" | "review" | "approved" | "executing" | "done";
}

/**
 * Raw parsed output from a [DECOMPOSITION] block.
 * Intermediate format before conversion to TaskNode tree.
 */
export interface DecompositionBlock {
  tasks: Array<{
    id: string;
    role?: string;
    description: string;
  }>;
  groups: string[][];
}

/** Configuration for the optional LLM-driven decomposer */
export interface DecomposerConfig {
  /** Enable LLM decomposition for complex tasks (default: false) */
  enabled: boolean;
  /** Max recursion depth (default: 3) */
  maxDepth: number;
  /** Model to use for decomposition */
  model: string;
  /** Require human approval before executing (default: true) */
  requireApproval: boolean;
}

export const DEFAULT_DECOMPOSER_CONFIG: DecomposerConfig = {
  enabled: false,
  maxDepth: 3,
  model: "claude-sonnet-4-20250514",
  requireApproval: true,
};
