// packages/orchestrator/src/decomposer/context.ts

/**
 * Format a task's lineage (ancestor chain) as an indented hierarchy.
 * Injected into worker prompts so they understand where their task fits.
 */
export function formatLineage(lineage: string[], current: string): string {
  const parts = lineage.map((desc, i) => `${"  ".repeat(i)}${i}. ${desc}`);
  parts.push(
    `${"  ".repeat(lineage.length)}${lineage.length}. ${current}  <-- (this task)`,
  );
  return parts.join("\n");
}

/**
 * Format sibling tasks for awareness context.
 * Helps workers avoid duplicating work being done in parallel.
 */
export function formatSiblings(siblings: string[], current: string): string {
  if (siblings.length === 0) return "";
  const lines = siblings.map((s) =>
    s === current ? `  - ${s}  <-- (you)` : `  - ${s}`,
  );
  return `Sibling tasks being worked on in parallel:\n${lines.join("\n")}`;
}
