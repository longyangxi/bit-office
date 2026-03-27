# Auto-Review for Team Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a developer finishes a task in team mode, the system automatically creates a review task and assigns it to the team's reviewer agent — no Leader involvement needed. Reviewer is optional (default on) and configured in the team creation UI.

**Architecture:** Add `autoReview` flag to team config. After each dev task:done, if autoReview is enabled and a reviewer agent exists, orchestrator auto-creates a review task with the dev's changedFiles + diff. 1 reviewer, tasks queue. Review results go through the existing reaction engine (PASS → done, FAIL → send back to dev).

**Tech Stack:** TypeScript, packages/orchestrator, packages/shared, apps/gateway

---

## File Map

| Task | Action | File | What |
|------|--------|------|------|
| 1 | Modify | `packages/shared/src/commands.ts` | Add `autoReview` + `reviewerBackend` to CreateTeamCommand |
| 1 | Modify | `packages/orchestrator/src/types.ts` | Add `autoReview` to CreateTeamOpts + OrchestratorOptions |
| 2 | Create | `packages/orchestrator/src/auto-reviewer.ts` | Build review prompt from dev result (reuse gateway's REQUEST_REVIEW logic) |
| 2 | Create | `packages/orchestrator/src/__tests__/auto-reviewer.test.ts` | Tests |
| 3 | Modify | `packages/orchestrator/src/orchestrator.ts` | After dev task:done, call auto-reviewer if enabled |
| 4 | Modify | `apps/gateway/src/index.ts` | Pass autoReview config from CREATE_TEAM to orchestrator |
| 4 | Modify | `packages/shared/src/events.ts` | Add autoReview field to AGENTS_SYNC for UI state |

---

## Task 1: Add autoReview to Team Config Schema

**Files:**
- Modify: `packages/shared/src/commands.ts`
- Modify: `packages/orchestrator/src/types.ts`

- [ ] **Step 1: Add fields to CreateTeamCommand schema**

In `packages/shared/src/commands.ts`, find `CreateTeamCommand` (line 57). Add two optional fields:

```typescript
export const CreateTeamCommand = z.object({
  type: z.literal("CREATE_TEAM"),
  leadId: z.string(),
  memberIds: z.array(z.string()),
  backends: z.record(z.string(), z.string()).optional(),
  workDir: z.string().optional(),
  autoReview: z.boolean().optional(),            // default true
  reviewerBackend: z.string().optional(),         // AI backend for reviewer
});
```

- [ ] **Step 2: Add autoReview to orchestrator types**

In `packages/orchestrator/src/types.ts`, add to `CreateTeamOpts`:

```typescript
export interface CreateTeamOpts {
  leadPresetIndex: number;
  memberPresets: Array<{ name: string; role: string; personality?: string; palette?: number }>;
  backends?: Record<string, string>;
  /** Auto-review dev work when complete (default: true) */
  autoReview?: boolean;
  /** AI backend ID for the auto-reviewer agent */
  reviewerBackend?: string;
}
```

Also add to `OrchestratorOptions` so the orchestrator knows the global default:

```typescript
/** Auto-review configuration for team mode */
autoReview?: boolean;
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/commands.ts packages/orchestrator/src/types.ts
git commit -m "feat(auto-review): add autoReview + reviewerBackend to team config schema"
```

---

## Task 2: Auto-Reviewer Module

**Files:**
- Create: `packages/orchestrator/src/auto-reviewer.ts`
- Create: `packages/orchestrator/src/__tests__/auto-reviewer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/src/__tests__/auto-reviewer.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/marklong/Documents/longames/bit-office/packages/orchestrator && npx vitest run src/__tests__/auto-reviewer.test.ts`

- [ ] **Step 3: Implement auto-reviewer.ts**

```typescript
// packages/orchestrator/src/auto-reviewer.ts

/**
 * Auto-reviewer — builds review tasks for completed dev work.
 * Reuses the same review prompt pattern as the gateway's REQUEST_REVIEW handler
 * but runs entirely within the orchestrator (no gateway dependency).
 */

const MAX_DIFF_CHARS = 6000;

export interface AutoReviewCheck {
  autoReview: boolean;
  role: string;
  isTeamLead: boolean;
  hasReviewer: boolean;
}

/**
 * Should this task:done trigger an auto-review?
 */
export function shouldAutoReview(check: AutoReviewCheck): boolean {
  if (!check.autoReview) return false;
  if (check.isTeamLead) return false;
  if (!check.hasReviewer) return false;
  // Don't review reviewers
  if (check.role.toLowerCase().includes("review")) return false;
  return true;
}

export interface ReviewPromptInput {
  changedFiles: string[];
  summary: string;
  entryFile?: string;
  diff: string;
  devName: string;
  devTaskId: string;
}

/**
 * Build a review prompt from dev task results.
 * Same structure as gateway's REQUEST_REVIEW but self-contained.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const { changedFiles, summary, entryFile, diff, devName, devTaskId } = input;

  const fileList = changedFiles.map(f => `- ${f}`).join("\n");

  let diffSection: string;
  if (diff.length > MAX_DIFF_CHARS) {
    diffSection = `\n===== DIFF (truncated — ${diff.length} chars total) =====\n${diff.slice(0, MAX_DIFF_CHARS)}\n... (truncated — use Read tool to see full files)`;
  } else if (diff) {
    diffSection = `\n===== DIFF =====\n${diff}`;
  } else {
    diffSection = "\n(No diff available — read the files to review)";
  }

  return [
    `Auto-review of ${devName}'s work (task: ${devTaskId}).`,
    `Review the code changes below. Focus on the DIFF for what changed, Read files only if you need surrounding context.`,
    `Only flag real bugs, crashes, security issues, logic errors. Skip style/naming suggestions.`,
    ``,
    `Files changed:\n${fileList}`,
    entryFile ? `Entry: ${entryFile}` : "",
    summary ? `Summary: ${summary}` : "",
    diffSection,
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /Users/marklong/Documents/longames/bit-office/packages/orchestrator && npx vitest run src/__tests__/auto-reviewer.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/auto-reviewer.ts packages/orchestrator/src/__tests__/auto-reviewer.test.ts
git commit -m "feat(auto-review): add shouldAutoReview + buildReviewPrompt module"
```

---

## Task 3: Wire Auto-Review into Orchestrator

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Add autoReview state to Orchestrator**

Import:
```typescript
import { shouldAutoReview, buildReviewPrompt } from "./auto-reviewer.js";
```

Add properties:
```typescript
private autoReview: boolean;
private reviewerBackend: string | null = null;
/** Queue of pending review tasks (dev task IDs waiting for reviewer) */
private reviewQueue: Array<{ devAgentId: string; taskId: string; prompt: string }> = [];
/** Is the reviewer currently busy? */
private reviewerBusy = false;
```

In constructor:
```typescript
this.autoReview = opts.autoReview ?? true;  // default on
```

- [ ] **Step 2: Add auto-review trigger in task:done handler**

In `_handleSessionEventUnsafe`, find the scheduler-managed task tracking block (the one that calls `this.activeScheduler.taskCompleted`). AFTER the scheduler tracking, add:

```typescript
    // ── Auto-review: queue review for completed dev tasks ──
    if (event.type === "task:done" && this.autoReview) {
      const session = this.agentManager.get(agentId);
      if (session) {
        const isTeamLead = this.agentManager.isTeamLead(agentId);
        const hasReviewer = this.agentManager.getAll().some(
          s => s.role?.toLowerCase().includes("review") && !this.agentManager.isTeamLead(s.agentId)
        );

        if (shouldAutoReview({
          autoReview: this.autoReview,
          role: session.role ?? "",
          isTeamLead,
          hasReviewer,
        })) {
          this.queueAutoReview(agentId, event.taskId, event.result);
        }
      }
    }
```

- [ ] **Step 3: Add review queue management methods**

```typescript
  private queueAutoReview(devAgentId: string, taskId: string, result: TaskResultPayload): void {
    const session = this.agentManager.get(devAgentId);
    if (!session) return;

    // Get diff from worktree
    let diff = "";
    if (session.worktreePath && result.changedFiles.length > 0) {
      try {
        const { execFileSync } = require("child_process");
        diff = execFileSync("git", ["diff", "HEAD", "--", ...result.changedFiles], {
          cwd: session.worktreePath,
          encoding: "utf-8",
          timeout: 5000,
          maxBuffer: 200 * 1024,
        }).trim();
      } catch { /* no diff available */ }
    }

    const prompt = buildReviewPrompt({
      changedFiles: result.changedFiles,
      summary: result.summary,
      entryFile: result.entryFile,
      diff,
      devName: session.name,
      devTaskId: taskId,
    });

    this.reviewQueue.push({ devAgentId, taskId, prompt });
    console.log(`[AutoReview] Queued review for ${session.name}'s task ${taskId} (queue: ${this.reviewQueue.length})`);
    this.processReviewQueue();
  }

  private processReviewQueue(): void {
    if (this.reviewerBusy || this.reviewQueue.length === 0) return;

    const reviewer = this.agentManager.getAll().find(
      s => s.role?.toLowerCase().includes("review") && !this.agentManager.isTeamLead(s.agentId)
    );
    if (!reviewer) return;

    // Check if reviewer is idle
    if (reviewer.status !== "idle") {
      // Will retry when reviewer's current task completes
      return;
    }

    const next = this.reviewQueue.shift()!;
    this.reviewerBusy = true;
    const reviewTaskId = `auto-review-${next.taskId}`;

    console.log(`[AutoReview] Dispatching review of ${next.devAgentId}'s task to ${reviewer.name}`);

    this.emitEvent({
      type: "task:delegated",
      fromAgentId: "system",
      toAgentId: reviewer.agentId,
      taskId: reviewTaskId,
      prompt: `Review ${next.devAgentId}'s work`,
    });

    // Store dev agent mapping for routing FAIL back
    this.delegationRouter.trackAutoReview(reviewTaskId, next.devAgentId);

    const repoPath = this.delegationRouter.getTeamProjectDir() ?? undefined;
    reviewer.runTask(reviewTaskId, next.prompt, repoPath);
  }
```

- [ ] **Step 4: Clear reviewerBusy when reviewer completes**

In the `task:done` handler, add a check for reviewer completion:

```typescript
    // ── Auto-review: advance queue when reviewer finishes ──
    if (event.type === "task:done") {
      const session = this.agentManager.get(agentId);
      if (session?.role?.toLowerCase().includes("review")) {
        this.reviewerBusy = false;
        this.processReviewQueue();
      }
    }
```

Also handle `task:failed` for the reviewer:
```typescript
    if (event.type === "task:failed") {
      const session = this.agentManager.get(agentId);
      if (session?.role?.toLowerCase().includes("review")) {
        this.reviewerBusy = false;
        this.processReviewQueue();
      }
    }
```

- [ ] **Step 5: Add trackAutoReview to DelegationRouter**

In `packages/orchestrator/src/delegation.ts`, add a simple method to track the dev-reviewer mapping:

```typescript
  /** Map auto-review taskId → dev agentId (for routing FAIL back to dev) */
  private autoReviewMap = new Map<string, string>();

  trackAutoReview(reviewTaskId: string, devAgentId: string): void {
    this.autoReviewMap.set(reviewTaskId, devAgentId);
  }

  getAutoReviewDevAgent(reviewTaskId: string): string | null {
    return this.autoReviewMap.get(reviewTaskId) ?? null;
  }

  // Also clear in clearAll():
  // this.autoReviewMap.clear();
```

- [ ] **Step 6: Export from index.ts**

```typescript
export { shouldAutoReview, buildReviewPrompt } from "./auto-reviewer.js";
```

- [ ] **Step 7: Build + test**

Run: `npx tsc --noEmit` and `npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auto-review): wire auto-review into orchestrator task:done flow

Dev completes → system queues review → reviewer picks up → PASS/FAIL.
1 reviewer, tasks queue. Reviewer FAIL routes through reaction engine."
```

---

## Task 4: Gateway + Integration

**Files:**
- Modify: `apps/gateway/src/index.ts`

- [ ] **Step 1: Pass autoReview from CREATE_TEAM to orchestrator**

In `apps/gateway/src/index.ts`, find the `CREATE_TEAM` command handler. When creating the orchestrator or setting team config, pass through the `autoReview` and `reviewerBackend` fields:

Find where the team is created and add:
```typescript
// After team creation, configure auto-review
if (parsed.autoReview !== undefined) {
  orc.setAutoReview(parsed.autoReview);
}
```

This means we need a public `setAutoReview` method on the Orchestrator:

```typescript
// In orchestrator.ts
setAutoReview(enabled: boolean): void {
  this.autoReview = enabled;
}

getAutoReview(): boolean {
  return this.autoReview;
}
```

- [ ] **Step 2: Create reviewer agent on team creation if autoReview**

In the CREATE_TEAM handler, after creating the team members, if `autoReview` is enabled (default true) and no reviewer is in the member list, auto-create one:

```typescript
// After all team members are created
const hasReviewer = orc.getAllAgents().some(a =>
  a.role?.toLowerCase().includes("review") && a.teamId
);
if (parsed.autoReview !== false && !hasReviewer) {
  const reviewerId = `reviewer-${nanoid(6)}`;
  const reviewerBackendId = parsed.reviewerBackend ?? config.defaultBackend;
  orc.createAgent({
    agentId: reviewerId,
    name: "Sophie",
    role: "Code Reviewer",
    personality: "Constructive and thorough reviewer.",
    backend: reviewerBackendId,
    teamId: teamId,
  });
  console.log(`[Gateway] Auto-created reviewer agent: ${reviewerId} (backend: ${reviewerBackendId})`);
}
```

- [ ] **Step 3: Build + verify gateway compiles**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(auto-review): gateway passes autoReview config, auto-creates reviewer agent

CREATE_TEAM with autoReview=true (default) auto-creates a Code Reviewer
agent if none is in the member list."
```

---

## Task 5: Integration with Decomposer Scheduler

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`

- [ ] **Step 1: Don't finalize plan until reviews pass**

The current `checkSchedulerCompletion()` finalizes when all scheduler tasks complete. With auto-review, we need to wait for reviews too.

Update `checkSchedulerCompletion()`:

```typescript
  private checkSchedulerCompletion(): void {
    if (!this.activeScheduler || !this.activePlan) return;
    if (!this.activeScheduler.isComplete()) return;

    // If auto-review is enabled, wait for review queue to drain
    if (this.autoReview && (this.reviewQueue.length > 0 || this.reviewerBusy)) {
      console.log(`[Orchestrator] Scheduler done but reviews pending (queue: ${this.reviewQueue.length}, busy: ${this.reviewerBusy})`);
      return; // Will re-check when reviewer finishes
    }

    // ... existing finalization code ...
  }
```

Also add a re-check in the reviewer completion handler:

```typescript
    // In the reviewer task:done block:
    if (session?.role?.toLowerCase().includes("review")) {
      this.reviewerBusy = false;
      this.processReviewQueue();
      // Re-check scheduler completion (may have been waiting for reviews)
      this.checkSchedulerCompletion();
    }
```

- [ ] **Step 2: Build + test**

Run: `npx vitest run`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(auto-review): scheduler waits for review queue before finalizing plan"
```
