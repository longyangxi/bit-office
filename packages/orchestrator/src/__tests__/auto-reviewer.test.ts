import { describe, it, expect } from "vitest";
import { buildReviewPrompt, shouldAutoReview } from "../auto-reviewer.js";

describe("shouldAutoReview", () => {
  it("returns true for dev role when autoReview enabled", () => {
    expect(shouldAutoReview({
      autoReview: true,
      role: "Developer",
      isTeamLead: false,
      hasReviewer: true,
    })).toBe(true);
  });

  it("returns false when autoReview disabled", () => {
    expect(shouldAutoReview({
      autoReview: false,
      role: "Developer",
      isTeamLead: false,
      hasReviewer: true,
    })).toBe(false);
  });

  it("returns false for reviewer role (no self-review)", () => {
    expect(shouldAutoReview({
      autoReview: true,
      role: "Code Reviewer",
      isTeamLead: false,
      hasReviewer: true,
    })).toBe(false);
  });

  it("returns false for team lead", () => {
    expect(shouldAutoReview({
      autoReview: true,
      role: "Team Lead",
      isTeamLead: true,
      hasReviewer: true,
    })).toBe(false);
  });

  it("returns false when no reviewer agent exists", () => {
    expect(shouldAutoReview({
      autoReview: true,
      role: "Developer",
      isTeamLead: false,
      hasReviewer: false,
    })).toBe(false);
  });
});

describe("buildReviewPrompt", () => {
  it("includes changed files and summary", () => {
    const prompt = buildReviewPrompt({
      changedFiles: ["src/app.ts", "src/utils.ts"],
      summary: "Added authentication",
      entryFile: "src/app.ts",
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
      devName: "Leo",
      devTaskId: "dev-1",
    });
    expect(prompt).toContain("src/app.ts");
    expect(prompt).toContain("src/utils.ts");
    expect(prompt).toContain("Added authentication");
    expect(prompt).toContain("Leo");
    expect(prompt).toContain("DIFF");
  });

  it("handles empty diff gracefully", () => {
    const prompt = buildReviewPrompt({
      changedFiles: ["file.ts"],
      summary: "minor fix",
      diff: "",
      devName: "Leo",
      devTaskId: "dev-1",
    });
    expect(prompt).toContain("No diff available");
  });

  it("truncates large diffs", () => {
    const largeDiff = "x".repeat(10000);
    const prompt = buildReviewPrompt({
      changedFiles: ["file.ts"],
      summary: "big change",
      diff: largeDiff,
      devName: "Leo",
      devTaskId: "dev-1",
    });
    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(largeDiff.length);
  });
});
