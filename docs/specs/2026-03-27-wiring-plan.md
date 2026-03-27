# Plugin Architecture Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 3 standalone modules (Decomposer, Notifier, Agent stuck detection) into the live orchestrator, completing the plugin architecture refactor.

**Architecture:** 6 incremental tasks. Each produces a working, testable change. Tasks 1-2 are independent quick wins. Tasks 3-6 are the decomposer wiring chain.

**Tech Stack:** TypeScript, vitest, packages/orchestrator

**Spec:** `docs/specs/2026-03-27-plugin-architecture-summary.md`

---

## File Map

| Task | Action | File | What |
|------|--------|------|------|
| 1 | Modify | `packages/orchestrator/src/agent-session.ts` | Add `lastOutputAt` timestamp |
| 1 | Create | `packages/orchestrator/src/stuck-detector.ts` | Polling loop checking agent idle time |
| 1 | Create | `packages/orchestrator/src/__tests__/stuck-detector.test.ts` | Tests |
| 1 | Modify | `packages/orchestrator/src/orchestrator.ts` | Start/stop detector, wire to reaction engine |
| 2 | Modify | `packages/orchestrator/src/reaction/engine.ts` | Notify action calls Notifier plugin |
| 2 | Modify | `packages/orchestrator/src/orchestrator.ts` | Pass notifier to reaction engine |
| 2 | Create | `packages/orchestrator/src/notifier/__tests__/websocket.test.ts` | Notifier integration test |
| 3 | Modify | `packages/orchestrator/src/prompt-templates.ts` | Leader prompt requires [DECOMPOSITION] output |
| 4 | Modify | `packages/orchestrator/src/orchestrator.ts` | Detect [DECOMPOSITION] in leader output, create scheduler |
| 4 | Modify | `packages/orchestrator/src/delegation.ts` | Accept scheduler-dispatched tasks |
| 5 | Create | `packages/orchestrator/src/agent-selector.ts` | Role-based agent matching |
| 5 | Create | `packages/orchestrator/src/__tests__/agent-selector.test.ts` | Tests |
| 6 | Modify | `packages/orchestrator/src/orchestrator.ts` | Connect scheduler completion to plan finalization |
| 6 | Create | `packages/orchestrator/src/__tests__/decomposer-integration.test.ts` | End-to-end test |

---

## Task 1: Agent Stuck Detection

**Goal:** Detect agents with no output for 5+ minutes, trigger `agent:stuck` reaction.

**Files:**
- Modify: `packages/orchestrator/src/agent-session.ts`
- Create: `packages/orchestrator/src/stuck-detector.ts`
- Create: `packages/orchestrator/src/__tests__/stuck-detector.test.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts`

- [ ] **Step 1: Add `lastOutputAt` to AgentSession**

In `packages/orchestrator/src/agent-session.ts`, add a timestamp property:

```typescript
// After line ~239 (near lastSummary)
/** Timestamp of last stdout data received (for stuck detection) */
lastOutputAt: number = 0;
```

Find where stdout data arrives (search for `stdoutBuffer` or `onData` or `data` event on process.stdout). In that handler, add:

```typescript
this.lastOutputAt = Date.now();
```

- [ ] **Step 2: Write failing test for StuckDetector**

```typescript
// packages/orchestrator/src/__tests__/stuck-detector.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StuckDetector } from "../stuck-detector.js";

describe("StuckDetector", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires callback for agents idle beyond threshold", () => {
    const onStuck = vi.fn();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: Date.now() - 6000, taskId: "t1" },
      ],
      onStuck,
    });

    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledWith("a1", "t1");
    detector.stop();
  });

  it("does not fire for recently active agents", () => {
    const onStuck = vi.fn();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: Date.now() - 1000, taskId: "t1" },
      ],
      onStuck,
    });

    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).not.toHaveBeenCalled();
    detector.stop();
  });

  it("does not fire twice for the same agent without new activity", () => {
    const onStuck = vi.fn();
    const now = Date.now();
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: now - 6000, taskId: "t1" },
      ],
      onStuck,
    });

    detector.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(1);
    detector.stop();
  });

  it("re-fires after agent becomes active then stuck again", () => {
    const onStuck = vi.fn();
    let lastOutput = Date.now() - 6000;
    const detector = new StuckDetector({
      thresholdMs: 5000,
      pollIntervalMs: 1000,
      getWorkingAgents: () => [
        { agentId: "a1", lastOutputAt: lastOutput, taskId: "t1" },
      ],
      onStuck,
    });

    detector.start();
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(1);

    // Agent becomes active again
    lastOutput = Date.now();
    vi.advanceTimersByTime(1000);
    // Then goes stuck again
    lastOutput = Date.now() - 6000;
    vi.advanceTimersByTime(1000);
    expect(onStuck).toHaveBeenCalledTimes(2);
    detector.stop();
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd /Users/marklong/Documents/longames/bit-office/packages/orchestrator && npx vitest run src/__tests__/stuck-detector.test.ts`

- [ ] **Step 4: Implement StuckDetector**

```typescript
// packages/orchestrator/src/stuck-detector.ts

export interface WorkingAgent {
  agentId: string;
  lastOutputAt: number;
  taskId: string;
}

export interface StuckDetectorConfig {
  /** Idle time before declaring stuck (default: 300_000 = 5 min) */
  thresholdMs: number;
  /** How often to check (default: 60_000 = 1 min) */
  pollIntervalMs: number;
  /** Callback to get current working agents */
  getWorkingAgents: () => WorkingAgent[];
  /** Called when an agent is detected as stuck */
  onStuck: (agentId: string, taskId: string) => void;
}

export class StuckDetector {
  private config: StuckDetectorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Track which agents we already reported as stuck (avoid spam) */
  private reportedStuck = new Set<string>();

  constructor(config: StuckDetectorConfig) {
    this.config = config;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.check(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    const now = Date.now();
    const agents = this.config.getWorkingAgents();

    for (const agent of agents) {
      const idleMs = now - agent.lastOutputAt;

      if (idleMs >= this.config.thresholdMs) {
        if (!this.reportedStuck.has(agent.agentId)) {
          this.reportedStuck.add(agent.agentId);
          this.config.onStuck(agent.agentId, agent.taskId);
        }
      } else {
        // Agent is active — clear the reported flag so we can detect again later
        this.reportedStuck.delete(agent.agentId);
      }
    }
  }
}
```

- [ ] **Step 5: Run test, verify pass**

- [ ] **Step 6: Wire into orchestrator**

In `packages/orchestrator/src/orchestrator.ts`:

Add import:
```typescript
import { StuckDetector } from "./stuck-detector.js";
```

Add property:
```typescript
private stuckDetector: StuckDetector;
```

In constructor (after reactionEngine init):
```typescript
this.stuckDetector = new StuckDetector({
  thresholdMs: 300_000,  // 5 minutes
  pollIntervalMs: 60_000, // check every minute
  getWorkingAgents: () => {
    const agents: { agentId: string; lastOutputAt: number; taskId: string }[] = [];
    for (const session of this.agentManager.getAll()) {
      if (session.status === "working" && session.lastOutputAt > 0) {
        agents.push({
          agentId: session.agentId,
          lastOutputAt: session.lastOutputAt,
          taskId: session.currentTaskId ?? "unknown",
        });
      }
    }
    return agents;
  },
  onStuck: (agentId, taskId) => {
    const session = this.agentManager.get(agentId);
    if (!session) return;
    const ctx: ReactionContext = {
      agentId,
      taskId,
      error: `Agent ${session.name} has been idle for 5+ minutes`,
      role: session.role,
      session: this.buildSessionFacade(session),
      orchestrator: this.buildOrchestratorFacade(),
    };
    this.reactionEngine.handle("agent:stuck", ctx);
  },
});
this.stuckDetector.start();
```

In `destroy()`:
```typescript
this.stuckDetector.stop();
```

Note: `session.currentTaskId` may be private. Check and expose via getter if needed.

- [ ] **Step 7: Build + test**

Run: `npx tsc --noEmit` and `npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add agent stuck detection — polls working agents, triggers reaction engine"
```

---

## Task 2: Connect Notifier to Reaction Engine

**Goal:** Make the `"notify"` action actually send through a Notifier plugin instead of raw event emission.

**Files:**
- Modify: `packages/orchestrator/src/reaction/engine.ts`
- Modify: `packages/orchestrator/src/reaction/types.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Create: `packages/orchestrator/src/notifier/__tests__/websocket.test.ts`

- [ ] **Step 1: Add Notifier to OrchestratorFacade**

In `packages/orchestrator/src/reaction/types.ts`, update `OrchestratorFacade`:

```typescript
import type { Notifier } from "../notifier/types.js";

export interface OrchestratorFacade {
  getTeamLead(): AgentSessionFacade | null;
  runTask(agentId: string, taskId: string, prompt: string): void;
  forceFinalize(agentId: string): void;
  emitNotification(notification: OrchestratorNotification): void;
  /** Notifier plugin (if registered) — preferred over raw emitNotification */
  notifier?: Notifier;
}
```

- [ ] **Step 2: Update engine's notify action to use Notifier**

In `packages/orchestrator/src/reaction/engine.ts`, update the `"notify"` case:

```typescript
case "notify": {
  const notification: OrchestratorNotification = {
    title: `Agent ${ctx.agentId} needs attention`,
    message: ctx.error ?? `Trigger: ${ctx.taskId}`,
    priority: "urgent",
    agentId: ctx.agentId,
    taskId: ctx.taskId,
  };
  // Prefer Notifier plugin if available, fallback to raw event
  if (ctx.orchestrator.notifier) {
    ctx.orchestrator.notifier.send(notification).catch(err =>
      console.warn("[ReactionEngine] Notifier.send failed:", err));
  }
  // Always emit as event too (for UI)
  ctx.orchestrator.emitNotification(notification);
  break;
}
```

- [ ] **Step 3: Wire notifier in orchestrator facade**

In `packages/orchestrator/src/orchestrator.ts`, add a `notifier` property and pass it:

```typescript
private notifier: Notifier | null = null;

// In constructor, after reactionEngine:
if (opts.notifier) {
  this.notifier = opts.notifier;
}
```

Update `buildOrchestratorFacade()`:
```typescript
notifier: this.notifier ?? undefined,
```

Add `notifier?: Notifier` to `OrchestratorOptions` in `types.ts`.

- [ ] **Step 4: Write notifier test**

```typescript
// packages/orchestrator/src/notifier/__tests__/websocket.test.ts
import { describe, it, expect, vi } from "vitest";
import { createWebSocketNotifier } from "../websocket.js";

describe("createWebSocketNotifier", () => {
  it("emits notification event via callback", async () => {
    const emitEvent = vi.fn();
    const notifier = createWebSocketNotifier(emitEvent);

    await notifier.send({
      title: "Test",
      message: "Hello",
      priority: "info",
    });

    expect(emitEvent).toHaveBeenCalledWith({
      type: "notification",
      title: "Test",
      message: "Hello",
      priority: "info",
    });
  });

  it("has name 'websocket'", () => {
    const notifier = createWebSocketNotifier(vi.fn());
    expect(notifier.name).toBe("websocket");
  });
});
```

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: connect Notifier plugin to reaction engine's notify action"
```

---

## Task 3: Update Leader Prompt for [DECOMPOSITION]

**Goal:** Teach the leader to output structured `[DECOMPOSITION]` blocks during execute phase.

**Files:**
- Modify: `packages/orchestrator/src/prompt-templates.ts`

- [ ] **Step 1: Update `leader-initial` template**

Find the `leader-initial` template in `PROMPT_DEFAULTS` (line ~58). Replace the delegation instructions with:

```typescript
"leader-initial": `You are {{name}}, the Team Lead. {{personality}}
You CANNOT write code, run commands, or use any tools. You can ONLY delegate.

Team:
{{teamRoster}}

**DELEGATION FORMAT — you MUST use this structured format:**

[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Complete description of what to build..." },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review the implementation..." }
  ],
  "groups": [["dev-1"], ["review-1"]]
}
[/DECOMPOSITION]

Rules:
- Each task gets a unique string id and a role ("Developer" or "Code Reviewer")
- "groups" defines execution order: tasks in the same group run in parallel, groups run sequentially
- Developers come before reviewers in groups
- Each developer gets ONE complete, end-to-end task that produces a RUNNABLE deliverable
- Split by feature area, not by file
- Skip review for trivial changes (omit the reviewer task)
- The project directory is managed by the system — do NOT specify paths

If the task is simple enough for a single developer, output a single-task decomposition:
[DECOMPOSITION]
{"tasks": [{"id": "dev-1", "role": "Developer", "description": "..."}], "groups": [["dev-1"]]}
[/DECOMPOSITION]

Approved plan:
{{originalTask}}

Task: {{prompt}}`,
```

- [ ] **Step 2: Update `leader-result` template**

In the `leader-result` template, add a note about using [DECOMPOSITION] format when delegating more work:

After "Next step (pick exactly ONE):", add:
```
- Need to delegate → use [DECOMPOSITION] format (see above)
```

Actually, `leader-result` doesn't have the format instructions. Add a brief reminder before the "Next step" section:

```
When delegating, use this format:
[DECOMPOSITION]
{"tasks": [{"id": "...", "role": "...", "description": "..."}], "groups": [["..."]]}
[/DECOMPOSITION]
```

- [ ] **Step 3: Keep backward compat — also detect @AgentName delegation**

The old format `@AgentName: task` should still work as a fallback. The orchestrator will check for [DECOMPOSITION] first; if not found, fall through to existing delegation parsing. No code change needed here — just a design note for Task 4.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/prompt-templates.ts
git commit -m "feat: update leader prompts to require [DECOMPOSITION] output format"
```

---

## Task 4: Wire Scheduler into Orchestrator Execute Phase

**Goal:** When leader output contains [DECOMPOSITION], parse it and dispatch via TaskScheduler instead of waiting for @AgentName delegation.

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`

- [ ] **Step 1: Add imports and properties**

```typescript
import { TaskScheduler, tryParseDecomposition } from "./decomposer/index.js";
import type { DecompositionPlan, TaskNode } from "./decomposer/index.js";
```

Add property:
```typescript
/** Active decomposition scheduler (null when using legacy delegation) */
private activeScheduler: TaskScheduler | null = null;
private activePlan: DecompositionPlan | null = null;
```

- [ ] **Step 2: Detect [DECOMPOSITION] in leader task:done handler**

In `_handleSessionEventUnsafe`, find where `task:done` is processed for leaders. Currently the leader's output goes through `DelegationRouter.wireResultForwarding()` which handles `@AgentName:` parsing.

Add detection BEFORE the existing delegation flow (around where `task:done` is handled):

```typescript
// In task:done handler, after checking it's a leader agent:
if (event.type === "task:done" && this.agentManager.isTeamLead(agentId)) {
  const output = event.result?.fullOutput ?? event.result?.summary ?? "";
  const plan = tryParseDecomposition(output, this.delegationRouter.getOriginalTask() ?? "");

  if (plan) {
    console.log(`[Orchestrator] Decomposition detected: ${plan.tree.children.length} tasks in ${plan.groups.length} groups`);
    this.activePlan = plan;
    this.activeScheduler = new TaskScheduler(plan, (task, contextPrompt) => {
      this.dispatchDecomposedTask(task, contextPrompt);
    });
    this.activeScheduler.start();
    return; // Don't fall through to legacy delegation
  }
  // No [DECOMPOSITION] block — fall through to legacy @AgentName delegation
}
```

- [ ] **Step 3: Add dispatchDecomposedTask method**

```typescript
private dispatchDecomposedTask(task: TaskNode, contextPrompt: string): void {
  // Find a matching agent by role
  const agentId = this.selectAgentForTask(task);
  if (!agentId) {
    console.warn(`[Orchestrator] No available agent for task ${task.id} (role: ${task.role})`);
    return;
  }

  // Build prompt with context
  const prompt = `${task.description}\n\n${contextPrompt}`;
  const taskId = task.id;
  task.assignedTo = agentId;

  // Set up worktree if needed
  const repoPath = this.delegationRouter.getTeamProjectDir() ?? undefined;
  this.setupWorktreeForAgent(agentId, taskId, repoPath);

  // Run the task
  this.runTask(agentId, taskId, prompt, { repoPath });

  console.log(`[Orchestrator] Dispatched ${task.id} → ${agentId} (${task.role})`);
}
```

- [ ] **Step 4: Handle task completion for scheduler-managed tasks**

In the `task:done` handler, check if the completed task belongs to the active scheduler:

```typescript
// In task:done handler, before existing logic:
if (this.activeScheduler && event.type === "task:done") {
  const taskId = event.taskId;
  const plan = this.activePlan;
  if (plan?.tree.children.some(c => c.id === taskId)) {
    this.activeScheduler.taskCompleted(taskId, event.result?.summary);
    if (this.activeScheduler.isComplete()) {
      console.log(`[Orchestrator] All decomposed tasks complete`);
      this.activePlan = null;
      this.activeScheduler = null;
      // Emit final result
    }
    return;
  }
}

// Same for task:failed
if (this.activeScheduler && event.type === "task:failed") {
  const taskId = event.taskId;
  if (this.activePlan?.tree.children.some(c => c.id === taskId)) {
    this.activeScheduler.taskFailed(taskId, event.error);
    // Reaction engine handles the failure (retry, escalate, etc.)
    // Scheduler auto-advances to next group when current group is all done/failed
    if (this.activeScheduler.isComplete()) {
      this.activePlan = null;
      this.activeScheduler = null;
    }
  }
}
```

- [ ] **Step 5: Build + test**

Run: `npx tsc --noEmit` and `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire TaskScheduler into orchestrator execute phase

Detects [DECOMPOSITION] blocks in leader output and dispatches
tasks via scheduler with lineage/siblings context injection.
Falls back to legacy @AgentName delegation if no block found."
```

---

## Task 5: Agent Selection Logic

**Goal:** Select the best available agent for a decomposed task based on role matching.

**Files:**
- Create: `packages/orchestrator/src/agent-selector.ts`
- Create: `packages/orchestrator/src/__tests__/agent-selector.test.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/orchestrator/src/__tests__/agent-selector.test.ts
import { describe, it, expect } from "vitest";
import { selectAgent } from "../agent-selector.js";

const agents = [
  { agentId: "lead-1", role: "Team Lead", status: "idle" as const, isTeamLead: true },
  { agentId: "dev-1", role: "Developer", status: "idle" as const, isTeamLead: false },
  { agentId: "dev-2", role: "Developer", status: "working" as const, isTeamLead: false },
  { agentId: "rev-1", role: "Code Reviewer", status: "idle" as const, isTeamLead: false },
];

describe("selectAgent", () => {
  it("selects idle agent matching role", () => {
    expect(selectAgent(agents, "Developer")).toBe("dev-1");
  });

  it("skips busy agents", () => {
    const allBusyDevs = agents.map(a =>
      a.agentId === "dev-1" ? { ...a, status: "working" as const } : a
    );
    // Both devs busy — returns null
    expect(selectAgent(allBusyDevs, "Developer")).toBeNull();
  });

  it("selects reviewer for review role", () => {
    expect(selectAgent(agents, "Code Reviewer")).toBe("rev-1");
  });

  it("never selects team lead", () => {
    expect(selectAgent(agents, "Team Lead")).toBeNull();
  });

  it("falls back to any idle non-lead agent if no role match", () => {
    expect(selectAgent(agents, "QA Engineer")).toBe("dev-1"); // first idle non-lead
  });

  it("returns null when all agents busy", () => {
    const allBusy = agents.map(a => ({ ...a, status: "working" as const }));
    expect(selectAgent(allBusy, "Developer")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement agent-selector.ts**

```typescript
// packages/orchestrator/src/agent-selector.ts

import type { AgentStatus } from "./types.js";

export interface AgentCandidate {
  agentId: string;
  role: string;
  status: AgentStatus;
  isTeamLead: boolean;
}

/**
 * Select the best available agent for a task.
 *
 * Priority:
 * 1. Idle agent matching the requested role (never Team Lead)
 * 2. Any idle non-lead agent (fallback)
 * 3. null (no agent available — task should be queued)
 */
export function selectAgent(agents: AgentCandidate[], requestedRole: string): string | null {
  // Never assign to team lead
  const available = agents.filter(a => !a.isTeamLead && a.status === "idle");
  if (available.length === 0) return null;

  // Prefer exact role match
  const roleMatch = available.find(a =>
    a.role.toLowerCase() === requestedRole.toLowerCase()
  );
  if (roleMatch) return roleMatch.agentId;

  // Partial match (e.g. "Developer" matches "Senior Developer")
  const partialMatch = available.find(a =>
    a.role.toLowerCase().includes(requestedRole.toLowerCase()) ||
    requestedRole.toLowerCase().includes(a.role.toLowerCase())
  );
  if (partialMatch) return partialMatch.agentId;

  // Fallback: any idle non-lead
  return available[0].agentId;
}
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Wire into orchestrator**

Replace the placeholder `selectAgentForTask` in Task 4 with real logic:

```typescript
import { selectAgent } from "./agent-selector.js";

private selectAgentForTask(task: TaskNode): string | null {
  const candidates = this.agentManager.getAll().map(s => ({
    agentId: s.agentId,
    role: s.role ?? "",
    status: s.status,
    isTeamLead: this.agentManager.isTeamLead(s.agentId),
  }));
  return selectAgent(candidates, task.role ?? "Developer");
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add role-based agent selection for decomposed tasks"
```

---

## Task 6: Scheduler Completion + Integration Test

**Goal:** When all scheduler groups complete, emit the final team result. Add an end-to-end test.

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Create: `packages/orchestrator/src/__tests__/decomposer-integration.test.ts`

- [ ] **Step 1: Handle scheduler completion in orchestrator**

When `this.activeScheduler.isComplete()` becomes true, synthesize a final result:

```typescript
if (this.activeScheduler.isComplete()) {
  const plan = this.activePlan!;
  const allDone = plan.tree.children.every(c => c.status === "done");
  const results = plan.tree.children
    .filter(c => c.result)
    .map(c => `[${c.id}] ${c.result}`)
    .join("\n");

  console.log(`[Orchestrator] Decomposition plan ${allDone ? "completed" : "finished with failures"}`);

  // Emit as final team result
  this.emitEvent({
    type: "task:done",
    agentId: this.agentManager.getTeamLead() ?? "system",
    taskId: plan.id,
    result: {
      summary: allDone
        ? `All ${plan.tree.children.length} tasks completed successfully.\n${results}`
        : `Plan completed with failures.\n${results}`,
      changedFiles: [],
      diffStat: "",
      testResult: allDone ? "passed" : "failed",
    },
    isFinalResult: true,
  });

  this.activePlan = null;
  this.activeScheduler = null;
}
```

- [ ] **Step 2: Write integration test**

```typescript
// packages/orchestrator/src/__tests__/decomposer-integration.test.ts
import { describe, it, expect } from "vitest";
import { tryParseDecomposition } from "../decomposer/index.js";
import { TaskScheduler } from "../decomposer/index.js";
import { selectAgent, type AgentCandidate } from "../agent-selector.js";

describe("Decomposer integration", () => {
  const leaderOutput = `I'll break this into parallel workstreams.

[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Build the UI" },
    { "id": "dev-2", "role": "Developer", "description": "Build the API" },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review all code" }
  ],
  "groups": [["dev-1", "dev-2"], ["review-1"]]
}
[/DECOMPOSITION]

Let me coordinate the team.`;

  const agents: AgentCandidate[] = [
    { agentId: "lead-1", role: "Team Lead", status: "idle", isTeamLead: true },
    { agentId: "dev-a", role: "Developer", status: "idle", isTeamLead: false },
    { agentId: "dev-b", role: "Developer", status: "idle", isTeamLead: false },
    { agentId: "rev-a", role: "Code Reviewer", status: "idle", isTeamLead: false },
  ];

  it("end-to-end: parse → schedule → select → complete", () => {
    // 1. Parse
    const plan = tryParseDecomposition(leaderOutput, "Build full-stack app");
    expect(plan).not.toBeNull();
    expect(plan!.tree.children).toHaveLength(3);
    expect(plan!.groups).toEqual([["dev-1", "dev-2"], ["review-1"]]);

    // 2. Schedule + Select
    const dispatched: Array<{ taskId: string; agentId: string; context: string }> = [];

    const scheduler = new TaskScheduler(plan!, (task, context) => {
      const agentId = selectAgent(agents, task.role ?? "Developer");
      expect(agentId).not.toBeNull();
      dispatched.push({ taskId: task.id, agentId: agentId!, context });
      // Mark agent busy
      const agent = agents.find(a => a.agentId === agentId);
      if (agent) agent.status = "working";
    });

    scheduler.start();

    // Group 1: dev-1 and dev-2 dispatched concurrently
    expect(dispatched).toHaveLength(2);
    expect(dispatched.map(d => d.taskId).sort()).toEqual(["dev-1", "dev-2"]);
    expect(dispatched[0].context).toContain("Task Hierarchy");
    expect(dispatched[0].context).toContain("Parallel Work");

    // 3. Complete group 1
    agents.find(a => a.agentId === dispatched[0].agentId)!.status = "idle";
    scheduler.taskCompleted("dev-1", "UI done");
    expect(dispatched).toHaveLength(2); // group 2 not yet (dev-2 still running)

    agents.find(a => a.agentId === dispatched[1].agentId)!.status = "idle";
    scheduler.taskCompleted("dev-2", "API done");

    // Group 2: review-1 dispatched
    expect(dispatched).toHaveLength(3);
    expect(dispatched[2].taskId).toBe("review-1");

    // 4. Complete review
    scheduler.taskCompleted("review-1", "All good");
    expect(scheduler.isComplete()).toBe(true);
    expect(plan!.tree.status).toBe("done");
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (51 existing + 4 stuck + 2 notifier + 6 selector + 1 integration = ~64)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete decomposer wiring — scheduler completion + integration test

All 3 standalone modules now fully connected:
- Stuck detection → polls agents → triggers reaction engine
- Notifier → reaction engine notify action → WebSocket notifier
- Decomposer → leader [DECOMPOSITION] → scheduler → agent selection → dispatch"
```
