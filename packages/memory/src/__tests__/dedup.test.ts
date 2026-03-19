import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jaccardSimilarity, normalizeToWords, hashFact, dedupFact } from "../dedup.js";
import type { AgentFact } from "../types.js";

describe("normalizeToWords", () => {
  it("should lowercase and split into word set", () => {
    const words = normalizeToWords("User prefers SOLID borders over dashed");
    assert.ok(words.has("user"));
    assert.ok(words.has("prefers"));
    assert.ok(words.has("solid"));
    assert.ok(words.has("borders"));
    assert.ok(words.has("over"));
    assert.ok(words.has("dashed"));
  });

  it("should strip punctuation", () => {
    const words = normalizeToWords("Note: use TERM_HOVER for all buttons!");
    assert.ok(words.has("note"));
    assert.ok(words.has("termhover")); // underscore stripped
    assert.ok(words.has("buttons"));
  });

  it("should filter short words (<=2 chars)", () => {
    const words = normalizeToWords("a to is the big cat");
    assert.ok(!words.has("a"));
    assert.ok(!words.has("to"));
    assert.ok(!words.has("is"));
    assert.ok(words.has("the"));
    assert.ok(words.has("big"));
    assert.ok(words.has("cat"));
  });
});

describe("jaccardSimilarity", () => {
  it("should return 1.0 for identical sets", () => {
    const a = new Set(["hello", "world"]);
    const b = new Set(["hello", "world"]);
    assert.equal(jaccardSimilarity(a, b), 1.0);
  });

  it("should return 0.0 for disjoint sets", () => {
    const a = new Set(["hello", "world"]);
    const b = new Set(["foo", "bar"]);
    assert.equal(jaccardSimilarity(a, b), 0.0);
  });

  it("should return correct value for overlapping sets", () => {
    const a = new Set(["hello", "world", "foo"]);
    const b = new Set(["hello", "world", "bar"]);
    // intersection=2, union=4, jaccard=0.5
    assert.equal(jaccardSimilarity(a, b), 0.5);
  });

  it("should return 1.0 for two empty sets", () => {
    assert.equal(jaccardSimilarity(new Set(), new Set()), 1.0);
  });

  it("should return 0.0 when one set is empty", () => {
    assert.equal(jaccardSimilarity(new Set(["a"]), new Set()), 0.0);
  });
});

describe("hashFact", () => {
  it("should produce same hash for same normalized text", () => {
    assert.equal(hashFact("User prefers SOLID"), hashFact("user prefers solid"));
  });

  it("should produce different hashes for different text", () => {
    assert.notEqual(hashFact("user prefers solid"), hashFact("user prefers dashed"));
  });

  it("should return a 12-char hex string", () => {
    const h = hashFact("some fact");
    assert.equal(h.length, 12);
    assert.match(h, /^[a-f0-9]{12}$/);
  });
});

describe("dedupFact", () => {
  const makeFact = (text: string, count = 1): AgentFact => ({
    id: hashFact(text),
    category: "codebase_pattern",
    fact: text,
    reinforceCount: count,
    createdAt: "2026-01-01T00:00:00Z",
    lastSeen: "2026-01-01T00:00:00Z",
  });

  it("should return 'add' for a novel fact", () => {
    const existing = [makeFact("Use TERM_HOVER for interactive elements")];
    const result = dedupFact("User always runs tests before committing code", existing);
    assert.equal(result.action, "add");
  });

  it("should return 'reinforce' for an exact duplicate", () => {
    const existing = [makeFact("User prefers solid borders over dashed borders")];
    const result = dedupFact("User prefers solid borders over dashed borders", existing);
    assert.equal(result.action, "reinforce");
  });

  it("should return 'reinforce' for a similar fact above threshold", () => {
    const existing = [makeFact("User prefers solid borders over dashed borders")];
    // Very similar wording
    const result = dedupFact("User prefers solid borders instead of dashed borders", existing);
    assert.equal(result.action, "reinforce");
  });

  it("should return 'skip' for very short facts (< 3 words after normalization)", () => {
    const result = dedupFact("use solid", []);
    assert.equal(result.action, "skip");
  });

  it("should return 'add' when existing is empty", () => {
    const result = dedupFact("This codebase uses PixiJS v8 for rendering", []);
    assert.equal(result.action, "add");
  });
});
