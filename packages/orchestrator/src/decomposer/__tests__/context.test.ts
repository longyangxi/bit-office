import { describe, it, expect } from "vitest";
import { formatLineage, formatSiblings } from "../context.js";

describe("formatLineage", () => {
  it("formats a single-level hierarchy", () => {
    const result = formatLineage(["Build a snake game"], "Implement movement");
    expect(result).toContain("0. Build a snake game");
    expect(result).toContain("1. Implement movement");
    expect(result).toContain("<-- (this task)");
  });

  it("formats a multi-level hierarchy with indentation", () => {
    const result = formatLineage(
      ["Build platform", "Backend services"],
      "Auth endpoint",
    );
    expect(result).toContain("0. Build platform");
    expect(result).toContain("  1. Backend services");
    expect(result).toContain("    2. Auth endpoint  <-- (this task)");
  });

  it("handles empty lineage (root task)", () => {
    const result = formatLineage([], "Build everything");
    expect(result).toBe("0. Build everything  <-- (this task)");
  });
});

describe("formatSiblings", () => {
  it("formats sibling tasks with current marker", () => {
    const result = formatSiblings(
      ["Add scoring", "Add collision"],
      "Add scoring",
    );
    expect(result).toContain("Add scoring  <-- (you)");
    expect(result).toContain("  - Add collision");
  });

  it("returns empty string for no siblings", () => {
    expect(formatSiblings([], "task")).toBe("");
  });

  it("marks no sibling as current if not found", () => {
    const result = formatSiblings(["Task A", "Task B"], "Task C");
    expect(result).not.toContain("<-- (you)");
    expect(result).toContain("  - Task A");
    expect(result).toContain("  - Task B");
  });
});
