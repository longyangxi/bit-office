import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { setStorageRoot } from "../storage.js";
import {
  commitSession,
  buildRecoveryContext,
  getMemoryContext,
  getAgentL0,
  getSessionHistory,
  getAgentFacts,
  addManualFact,
  recordReviewFeedback,
  recordProjectCompletion,
  recordTechPreference,
  getMemoryStore,
} from "../memory.js";
import type { TaskCompletionData } from "../types.js";

// Each test gets a unique temp directory. Called at the START of each it().
let testCounter = 0;
function freshStorage(): void {
  const dir = join(tmpdir(), `bit-mem-${process.pid}-${++testCounter}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  setStorageRoot(dir);
}

// All describes share a module-global storage root, so they MUST run sequentially.
describe("@bit-office/memory", { concurrency: 1 }, () => {

describe("commitSession", { concurrency: 1 }, () => {
  it("should create session summary and save to disk", () => {
    freshStorage();
    const data: TaskCompletionData = {
      agentId: "alex-2",
      agentName: "Alex 2",
      stdout: `I redesigned the pagination bar.
Changed borders from dashed to solid for cleaner look.
Committed \`ad8ed51\` — only the MultiPaneView changes.
SUMMARY: Redesigned MultiPaneView pagination bar with styled buttons`,
      summary: "Redesigned MultiPaneView pagination bar with styled buttons",
      changedFiles: ["/Users/longsir/apps/web/src/components/MultiPaneView.tsx"],
      tokens: { input: 45000, output: 12000 },
    };

    const summary = commitSession(data);

    assert.equal(summary.what, "Redesigned MultiPaneView pagination bar with styled buttons");
    assert.ok(summary.commits.includes("ad8ed51"));
    assert.ok(summary.filesChanged.some(f => f.includes("MultiPaneView.tsx")));
    assert.ok(summary.decisions.length > 0);

    // Verify persisted
    const history = getSessionHistory("alex-2");
    assert.ok(history.latest !== null);
    assert.equal(history.latest!.what, summary.what);
    assert.equal(history.history.length, 1);
  });

  it("should maintain ring buffer of 10 sessions", () => {
    freshStorage();
    for (let i = 0; i < 15; i++) {
      commitSession({
        agentId: "alex-2",
        stdout: `SUMMARY: Task ${i + 1}\n`,
        summary: `Task ${i + 1}`,
        changedFiles: [],
        tokens: { input: 100, output: 50 },
      });
    }

    const history = getSessionHistory("alex-2");
    assert.equal(history.history.length, 10);
    assert.ok(history.latest!.what.includes("Task 15"));
    assert.ok(history.history[0].what.includes("Task 15"));
  });
});

describe("buildRecoveryContext", { concurrency: 1 }, () => {
  it("should include session summary when available", () => {
    freshStorage();
    commitSession({
      agentId: "alex-2",
      stdout: "SUMMARY: Optimized pagination UI",
      summary: "Optimized pagination UI",
      changedFiles: ["MultiPaneView.tsx"],
      tokens: { input: 1000, output: 500 },
    });

    const recovery = buildRecoveryContext("alex-2", {
      originalTask: "Fix the pagination",
    });

    assert.ok(recovery.sessionSummary !== undefined);
    assert.equal(recovery.sessionSummary!.what, "Optimized pagination UI");
    assert.equal(recovery.originalTask, "Fix the pagination");
  });

  it("should work with legacy fallback when no sessions", () => {
    freshStorage();
    const recovery = buildRecoveryContext("unknown-agent", {
      lastResult: "Some old result",
      recentMessages: [{ role: "user", text: "hello" }],
    });

    assert.equal(recovery.sessionSummary, undefined);
    assert.equal(recovery.lastResult, "Some old result");
    assert.equal(recovery.recentMessages?.length, 1);
  });
});

describe("getAgentL0", { concurrency: 1 }, () => {
  it("should return idle for agent with no sessions", () => {
    freshStorage();
    const l0 = getAgentL0("new-agent", "New Agent");
    assert.ok(l0.includes("idle"));
    assert.ok(l0.includes("[New Agent]"));
  });

  it("should return one-liner after session commit", () => {
    freshStorage();
    commitSession({
      agentId: "alex-2",
      stdout: 'Committed `abc1234`\nSUMMARY: Built snake game',
      summary: "Built snake game",
      changedFiles: [],
      tokens: { input: 100, output: 50 },
    });

    const l0 = getAgentL0("alex-2", "Alex 2");
    assert.ok(l0.includes("[Alex 2]"));
    assert.ok(l0.includes("Built snake game"));
    assert.ok(l0.includes("abc1234"));
  });
});

describe("getMemoryContext", { concurrency: 1 }, () => {
  it("should return empty string when no memory exists", () => {
    freshStorage();
    const ctx = getMemoryContext("some-agent");
    assert.equal(ctx, "");
  });

  it("should include agent facts after manual add", () => {
    freshStorage();
    addManualFact("alex-2", "This codebase uses PixiJS v8 for all rendering", "codebase_pattern");
    const ctx = getMemoryContext("alex-2");
    assert.ok(ctx.includes("AGENT KNOWLEDGE"));
    assert.ok(ctx.includes("PixiJS v8"));
  });

  it("should include legacy memory context", () => {
    freshStorage();
    recordTechPreference("Three.js");
    const ctx = getMemoryContext();
    assert.ok(ctx.includes("Three.js"));
  });
});

describe("addManualFact", { concurrency: 1 }, () => {
  it("should add a new fact", () => {
    freshStorage();
    addManualFact("alex-2", "User prefers solid borders over dashed", "user_preference");
    const facts = getAgentFacts("alex-2");
    assert.equal(facts.facts.length, 1);
    assert.equal(facts.facts[0].category, "user_preference");
    assert.equal(facts.facts[0].reinforceCount, 1);
  });

  it("should reinforce an existing similar fact", () => {
    freshStorage();
    addManualFact("alex-2", "User prefers solid borders over dashed", "user_preference");
    addManualFact("alex-2", "User prefers solid borders over dashed", "user_preference");
    const facts = getAgentFacts("alex-2");
    assert.equal(facts.facts.length, 1);
    assert.equal(facts.facts[0].reinforceCount, 2);
  });
});

describe("legacy operations", { concurrency: 1 }, () => {
  it("should record and retrieve review feedback", () => {
    freshStorage();
    recordReviewFeedback("VERDICT: FAIL\n1. Missing error handling\n2. No input validation");
    const store = getMemoryStore();
    assert.equal(store.reviewPatterns.length, 2);
  });

  it("should record project completion", () => {
    freshStorage();
    recordProjectCompletion("Built a snake game", "Canvas + JS", true);
    const store = getMemoryStore();
    assert.equal(store.projectHistory.length, 1);
    assert.ok(store.projectHistory[0].summary.includes("snake game"));
  });

  it("should record tech preference without duplicates", () => {
    freshStorage();
    recordTechPreference("Three.js");
    recordTechPreference("three.js");
    const store = getMemoryStore();
    assert.equal(store.techPreferences.length, 1);
  });
});

}); // end @bit-office/memory
