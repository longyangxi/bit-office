import { describe, it, expect } from "vitest";
import { parseDecompositionBlock, buildPlan, tryParseDecomposition } from "../parser.js";

const VALID_BLOCK = `Some leader output before...

[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Implement snake movement" },
    { "id": "dev-2", "role": "Developer", "description": "Add collision detection" },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review implementation" }
  ],
  "groups": [["dev-1", "dev-2"], ["review-1"]]
}
[/DECOMPOSITION]

More output after...`;

describe("parseDecompositionBlock", () => {
  it("extracts a valid block from surrounding text", () => {
    const result = parseDecompositionBlock(VALID_BLOCK);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(3);
    expect(result!.groups).toHaveLength(2);
    expect(result!.tasks[0].id).toBe("dev-1");
    expect(result!.tasks[0].role).toBe("Developer");
  });

  it("returns null when no block present", () => {
    expect(parseDecompositionBlock("just regular output")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseDecompositionBlock("[DECOMPOSITION]\n{bad json}\n[/DECOMPOSITION]")).toBeNull();
  });

  it("returns null when tasks array is empty", () => {
    const block = '[DECOMPOSITION]\n{"tasks": [], "groups": [["a"]]}\n[/DECOMPOSITION]';
    expect(parseDecompositionBlock(block)).toBeNull();
  });

  it("returns null when groups reference nonexistent task ID", () => {
    const block = '[DECOMPOSITION]\n{"tasks": [{"id": "a", "description": "task a"}], "groups": [["a", "b"]]}\n[/DECOMPOSITION]';
    expect(parseDecompositionBlock(block)).toBeNull();
  });

  it("returns null when task lacks id", () => {
    const block = '[DECOMPOSITION]\n{"tasks": [{"description": "no id"}], "groups": [["x"]]}\n[/DECOMPOSITION]';
    expect(parseDecompositionBlock(block)).toBeNull();
  });

  it("returns null when task lacks description", () => {
    const block = '[DECOMPOSITION]\n{"tasks": [{"id": "x"}], "groups": [["x"]]}\n[/DECOMPOSITION]';
    expect(parseDecompositionBlock(block)).toBeNull();
  });
});

describe("buildPlan", () => {
  it("creates a tree with root and leaf nodes", () => {
    const block = parseDecompositionBlock(VALID_BLOCK)!;
    const plan = buildPlan("Build snake game", block);

    expect(plan.rootTask).toBe("Build snake game");
    expect(plan.tree.kind).toBe("composite");
    expect(plan.tree.children).toHaveLength(3);
    expect(plan.tree.children[0].kind).toBe("atomic");
    expect(plan.tree.children[0].parentId).toBe("root");
    expect(plan.tree.children[0].lineage).toEqual(["Build snake game"]);
    expect(plan.groups).toEqual([["dev-1", "dev-2"], ["review-1"]]);
    expect(plan.phase).toBe("approved");
  });
});

describe("tryParseDecomposition", () => {
  it("returns plan for valid output", () => {
    const plan = tryParseDecomposition(VALID_BLOCK, "Build snake game");
    expect(plan).not.toBeNull();
    expect(plan!.tree.children).toHaveLength(3);
  });

  it("returns null for output without block", () => {
    expect(tryParseDecomposition("no block here", "task")).toBeNull();
  });
});
