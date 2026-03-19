import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSessionSummary, extractFactCandidates } from "../extract.js";
import type { TaskCompletionData } from "../types.js";

describe("extractSessionSummary", () => {
  const baseData: TaskCompletionData = {
    agentId: "test-agent",
    stdout: "",
    changedFiles: [],
    tokens: { input: 1000, output: 500 },
  };

  it("should use parsed summary as 'what'", () => {
    const result = extractSessionSummary({
      ...baseData,
      summary: "Redesigned MultiPaneView pagination bar with styled buttons",
    });
    assert.equal(result.what, "Redesigned MultiPaneView pagination bar with styled buttons");
  });

  it("should extract SUMMARY: from stdout", () => {
    const result = extractSessionSummary({
      ...baseData,
      stdout: "Some output\nSUMMARY: Built a snake game with canvas\nMore output",
    });
    assert.equal(result.what, "Built a snake game with canvas");
  });

  it("should extract git commits", () => {
    const result = extractSessionSummary({
      ...baseData,
      stdout: 'I committed the changes.\nCommitted `ad8ed51` — only the MultiPaneView changes.\nAlso commit abc1234 for the tests.',
    });
    assert.ok(result.commits.includes("ad8ed51"));
    assert.ok(result.commits.includes("abc1234"));
  });

  it("should extract decisions", () => {
    const result = extractSessionSummary({
      ...baseData,
      stdout: `- Changed borders from dashed to solid with lower opacity
- Used TERM_HOVER instead of hardcoded rgba because it's theme-aware
- Chose flexbox over grid for consistency`,
    });
    assert.ok(result.decisions.length >= 2);
  });

  it("should extract unfinished items", () => {
    const result = extractSessionSummary({
      ...baseData,
      stdout: `Task done.\nTODO: add unit tests for the new component\nThe agent-session.ts changes remain unstaged`,
    });
    assert.ok(result.unfinished.length >= 1);
    assert.ok(result.unfinished.some(u => u.includes("unit tests")));
  });

  it("should shorten file paths to last 3 segments", () => {
    const result = extractSessionSummary({
      ...baseData,
      changedFiles: ["/Users/longsir/Documents/ai/bit-office/apps/web/src/components/MultiPaneView.tsx"],
    });
    assert.equal(result.filesChanged[0], "src/components/MultiPaneView.tsx");
  });

  it("should include token counts", () => {
    const result = extractSessionSummary({
      ...baseData,
      tokens: { input: 45000, output: 12000 },
    });
    assert.deepEqual(result.tokens, { input: 45000, output: 12000 });
  });
});

describe("extractFactCandidates", () => {
  it("should extract user preference facts", () => {
    const candidates = extractFactCandidates(
      "The user prefers solid borders over dashed borders for a cleaner look"
    );
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some(c => c.category === "user_preference"));
  });

  it("should extract codebase pattern facts", () => {
    const candidates = extractFactCandidates(
      "This codebase uses PixiJS v8 for all rendering operations"
    );
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some(c => c.category === "codebase_pattern"));
  });

  it("should extract lesson learned facts", () => {
    const candidates = extractFactCandidates(
      "Note: the @types/node version conflicts are pre-existing and should not be fixed"
    );
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some(c => c.category === "lesson_learned"));
  });

  it("should not extract from very short matches", () => {
    const candidates = extractFactCandidates("the user likes it");
    // "it" is too short to match the 10-char minimum
    assert.equal(candidates.length, 0);
  });

  it("should deduplicate within extraction", () => {
    const candidates = extractFactCandidates(
      "This project uses TypeScript for everything.\nThis project uses TypeScript for everything."
    );
    // Should not have duplicates
    const facts = candidates.map(c => c.fact.toLowerCase());
    assert.equal(facts.length, new Set(facts).size);
  });

  it("should cap at 10 candidates", () => {
    // Generate a long output with many potential facts
    const lines = Array.from({ length: 20 }, (_, i) =>
      `Note: important thing number ${i + 1} about the codebase behavior and configuration`
    ).join("\n");
    const candidates = extractFactCandidates(lines);
    assert.ok(candidates.length <= 10);
  });
});
