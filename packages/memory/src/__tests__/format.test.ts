import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatRecoveryContext,
  formatAgentL0,
  formatAgentFacts,
  formatSharedKnowledge,
} from "../format.js";
import type { RecoveryContext, SessionHistoryStore, AgentFact, SharedKnowledge } from "../types.js";

describe("formatRecoveryContext", () => {
  it("should prefer sessionSummary over raw messages", () => {
    const recovery: RecoveryContext = {
      originalTask: "Optimize pagination",
      sessionSummary: {
        timestamp: new Date().toISOString(),
        what: "Redesigned MultiPaneView pagination bar",
        decisions: ["Changed borders from dashed to solid"],
        filesChanged: ["src/components/MultiPaneView.tsx"],
        commits: ["ad8ed51"],
        unfinished: ["agent-session.ts changes remain unstaged"],
        tokens: { input: 1000, output: 500 },
      },
      recentMessages: [{ role: "assistant", text: "some raw message" }],
    };

    const result = formatRecoveryContext(recovery);
    assert.ok(result.includes("Redesigned MultiPaneView pagination bar"));
    assert.ok(result.includes("ad8ed51"));
    assert.ok(result.includes("MultiPaneView.tsx"));
    assert.ok(result.includes("dashed to solid"));
    assert.ok(result.includes("unstaged"));
    // Should NOT contain raw messages when summary is available
    assert.ok(!result.includes("some raw message"));
  });

  it("should fall back to legacy format when no summary", () => {
    const recovery: RecoveryContext = {
      lastResult: "Changes committed successfully",
      recentMessages: [
        { role: "user", text: "commit" },
        { role: "assistant", text: "Done, committed ad8ed51" },
      ],
    };

    const result = formatRecoveryContext(recovery);
    assert.ok(result.includes("Changes committed successfully"));
    assert.ok(result.includes("[User]: commit"));
    assert.ok(result.includes("[You]: Done, committed ad8ed51"));
  });

  it("should include the recovery header", () => {
    const result = formatRecoveryContext({});
    assert.ok(result.includes("[Session recovered]"));
    assert.ok(result.includes("Ask the user if unsure"));
  });
});

describe("formatAgentL0", () => {
  it("should return idle message when no sessions", () => {
    const store: SessionHistoryStore = { latest: null, history: [] };
    const result = formatAgentL0("Alex 2", store);
    assert.ok(result.includes("[Alex 2]"));
    assert.ok(result.includes("idle"));
  });

  it("should return one-liner with latest summary", () => {
    const store: SessionHistoryStore = {
      latest: {
        timestamp: new Date().toISOString(),
        what: "Optimized pagination UI",
        decisions: [],
        filesChanged: [],
        commits: ["ad8ed51"],
        unfinished: [],
        tokens: { input: 1000, output: 500 },
      },
      history: [],
    };

    const result = formatAgentL0("Alex 2", store);
    assert.ok(result.includes("[Alex 2]"));
    assert.ok(result.includes("Optimized pagination UI"));
    assert.ok(result.includes("ad8ed51"));
    assert.ok(result.includes("just now") || result.includes("ago"));
  });
});

describe("formatAgentFacts", () => {
  const makeFact = (fact: string, category: AgentFact["category"], count: number): AgentFact => ({
    id: "test",
    category,
    fact,
    reinforceCount: count,
    createdAt: "2026-01-01T00:00:00Z",
    lastSeen: "2026-01-01T00:00:00Z",
  });

  it("should return empty string for no facts", () => {
    assert.equal(formatAgentFacts([]), "");
  });

  it("should format facts with category labels", () => {
    const facts = [
      makeFact("User prefers dark themes", "user_preference", 3),
      makeFact("Uses PixiJS v8 for rendering", "codebase_pattern", 2),
    ];
    const result = formatAgentFacts(facts);
    assert.ok(result.includes("AGENT KNOWLEDGE"));
    assert.ok(result.includes("Preference: User prefers dark themes"));
    assert.ok(result.includes("Codebase: Uses PixiJS v8"));
  });

  it("should sort by reinforceCount (most first)", () => {
    const facts = [
      makeFact("Low priority fact", "lesson_learned", 1),
      makeFact("High priority fact", "codebase_pattern", 5),
    ];
    const result = formatAgentFacts(facts);
    const highIdx = result.indexOf("High priority");
    const lowIdx = result.indexOf("Low priority");
    assert.ok(highIdx < lowIdx, "Higher reinforceCount should appear first");
  });

  it("should respect maxItems", () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      makeFact(`Fact number ${i}`, "codebase_pattern", 20 - i)
    );
    const result = formatAgentFacts(facts, 3);
    // Count bullet points
    const bullets = result.match(/^- /gm) ?? [];
    assert.equal(bullets.length, 3);
  });
});

describe("formatSharedKnowledge", () => {
  it("should return empty string for no items", () => {
    assert.equal(formatSharedKnowledge([]), "");
  });

  it("should format shared knowledge with header", () => {
    const items: SharedKnowledge[] = [
      {
        id: "test",
        fact: "This monorepo uses pnpm workspaces",
        source: "agent-1",
        confirmedBy: ["agent-1", "agent-2"],
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const result = formatSharedKnowledge(items);
    assert.ok(result.includes("PROJECT KNOWLEDGE"));
    assert.ok(result.includes("pnpm workspaces"));
  });
});
