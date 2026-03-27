import type { DecompositionBlock, DecompositionPlan, TaskNode } from "./types.js";

const DECOMPOSITION_REGEX = /\[DECOMPOSITION\]\s*([\s\S]*?)\s*\[\/DECOMPOSITION\]/;

/**
 * Extract a [DECOMPOSITION] block from Leader output.
 * Returns null if no block found or if parsing fails.
 */
export function parseDecompositionBlock(output: string): DecompositionBlock | null {
  const match = output.match(DECOMPOSITION_REGEX);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]);

    // Validate structure
    if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) return null;
    if (!Array.isArray(raw.groups) || raw.groups.length === 0) return null;

    // Validate each task has id and description
    for (const task of raw.tasks) {
      if (typeof task.id !== "string" || !task.id) return null;
      if (typeof task.description !== "string" || !task.description) return null;
    }

    // Validate all group references point to existing task IDs
    const taskIds = new Set(raw.tasks.map((t: { id: string }) => t.id));
    for (const group of raw.groups) {
      if (!Array.isArray(group)) return null;
      for (const id of group) {
        if (!taskIds.has(id)) return null;
      }
    }

    return {
      tasks: raw.tasks.map((t: { id: string; role?: string; description: string }) => ({
        id: t.id,
        role: t.role,
        description: t.description,
      })),
      groups: raw.groups,
    };
  } catch {
    return null;
  }
}

/**
 * Convert a DecompositionBlock into a DecompositionPlan with a TaskNode tree.
 * The root node is composite; each task in the block becomes an atomic leaf.
 */
export function buildPlan(rootDescription: string, block: DecompositionBlock): DecompositionPlan {
  const children: TaskNode[] = block.tasks.map((task, i) => ({
    id: task.id,
    parentId: "root",
    description: task.description,
    role: task.role,
    kind: "atomic" as const,
    status: "pending" as const,
    depth: 1,
    lineage: [rootDescription],
    children: [],
  }));

  const root: TaskNode = {
    id: "root",
    parentId: null,
    description: rootDescription,
    kind: "composite",
    status: "pending",
    depth: 0,
    lineage: [],
    children,
  };

  return {
    id: `plan-${Date.now()}`,
    rootTask: rootDescription,
    tree: root,
    groups: block.groups,
    phase: "approved",
  };
}

/**
 * Try to parse Leader output and build a plan in one step.
 * Returns null if no [DECOMPOSITION] block found.
 */
export function tryParseDecomposition(
  output: string,
  rootDescription: string,
): DecompositionPlan | null {
  const block = parseDecompositionBlock(output);
  if (!block) return null;
  return buildPlan(rootDescription, block);
}
