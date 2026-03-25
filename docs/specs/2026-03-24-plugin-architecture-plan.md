# Plugin Architecture Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `@bit-office/orchestrator` from monolithic engine to modular plugin architecture with Reaction Engine, Workspace abstraction, Task Decomposer, Agent Plugin, and PluginRegistry.

**Architecture:** Feature-first approach — each phase delivers independent value. Phase 1 (Reaction Engine) and Phase 2 (Workspace) are independent entry points. Phases 3-5 build on top.

**Tech Stack:** TypeScript, Node.js, vitest for testing, pnpm monorepo

**Spec:** `docs/specs/2026-03-24-plugin-architecture-design.md`

---

## Prerequisites

### Task 0.1: Install vitest

**Files:**
- Modify: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/vitest.config.ts`

- [ ] **Step 1: Add vitest to devDependencies**

```bash
cd packages/orchestrator && pnpm add -D vitest
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// packages/orchestrator/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add `"test": "vitest run"` to scripts.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/package.json packages/orchestrator/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add vitest to orchestrator package"
```

---

## File Map

### Phase 1 — Reaction Engine
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/orchestrator/src/reaction/types.ts` | ReactionTrigger, ReactionAction, ReactionRule, ReactionContext, facades |
| Create | `packages/orchestrator/src/reaction/engine.ts` | ReactionEngine class — match rules, execute actions |
| Create | `packages/orchestrator/src/reaction/defaults.ts` | DEFAULT_RULES array |
| Create | `packages/orchestrator/src/reaction/__tests__/engine.test.ts` | Unit tests |
| Create | `packages/orchestrator/src/reaction/index.ts` | Barrel exports |
| Modify | `packages/orchestrator/src/types.ts` | Add ReviewFailEvent, NotificationEvent |
| Modify | `packages/orchestrator/src/orchestrator.ts` | Replace retry logic with ReactionEngine |
| Modify | `packages/orchestrator/src/delegation.ts` | Emit `review:fail` event, remove devFixAttempts/maxDirectFixes |
| Modify | `packages/orchestrator/src/config.ts` | Remove retry/review constants (moved to reaction defaults) |
| Modify | `packages/orchestrator/src/index.ts` | Export reaction module, remove RetryTracker |
| Delete | `packages/orchestrator/src/retry.ts` | Replaced by reaction/engine.ts |

### Phase 2 — Workspace Abstraction
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/orchestrator/src/workspace/types.ts` | Workspace interface, WorkspaceInfo, configs |
| Create | `packages/orchestrator/src/workspace/worktree.ts` | WorktreeWorkspace implements Workspace |
| Create | `packages/orchestrator/src/workspace/post-create.ts` | Symlink + command execution |
| Create | `packages/orchestrator/src/workspace/__tests__/post-create.test.ts` | PostCreate unit tests |
| Create | `packages/orchestrator/src/workspace/__tests__/worktree.test.ts` | WorktreeWorkspace unit tests |
| Create | `packages/orchestrator/src/workspace/index.ts` | Barrel exports |
| Modify | `packages/orchestrator/src/orchestrator.ts` | Use Workspace interface instead of direct worktree calls |
| Modify | `packages/orchestrator/src/index.ts` | Export workspace module |
| Delete | `packages/orchestrator/src/worktree.ts` | Migrated to workspace/worktree.ts |

### Phase 3 — Task Decomposer
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/orchestrator/src/decomposer/types.ts` | TaskNode, DecompositionPlan, DecomposerConfig |
| Create | `packages/orchestrator/src/decomposer/parser.ts` | Parse [DECOMPOSITION] block from Leader output |
| Create | `packages/orchestrator/src/decomposer/context.ts` | formatLineage(), formatSiblings() |
| Create | `packages/orchestrator/src/decomposer/scheduler.ts` | Group-based dispatch + status propagation |
| Create | `packages/orchestrator/src/decomposer/llm-decomposer.ts` | Optional LLM classify + decompose |
| Create | `packages/orchestrator/src/decomposer/__tests__/parser.test.ts` | Parser unit tests |
| Create | `packages/orchestrator/src/decomposer/__tests__/context.test.ts` | Context formatting tests |
| Create | `packages/orchestrator/src/decomposer/__tests__/scheduler.test.ts` | Scheduler unit tests |
| Create | `packages/orchestrator/src/decomposer/index.ts` | Barrel exports |
| Modify | `packages/orchestrator/src/output-parser.ts` | Hook in [DECOMPOSITION] detection |
| Modify | `packages/orchestrator/src/prompt-templates.ts` | Add lineage/siblings variables |
| Modify | `packages/orchestrator/src/index.ts` | Export decomposer module |

### Phase 4 — Agent Plugin
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/orchestrator/src/agent/types.ts` | AgentPlugin interface, ActivityState, AgentSessionRef |
| Create | `packages/orchestrator/src/agent/index.ts` | Barrel exports |
| Create | `apps/gateway/src/agents/claude-code.ts` | Claude Code AgentPlugin |
| Create | `apps/gateway/src/agents/codex.ts` | Codex AgentPlugin |
| Create | `apps/gateway/src/agents/gemini.ts` | Gemini AgentPlugin |
| Create | `apps/gateway/src/agents/common.ts` | Shared helpers (version probe, etc.) |
| Create | `apps/gateway/src/agents/index.ts` | detectAndRegister() |
| Modify | `packages/orchestrator/src/agent-session.ts` | Use AgentPlugin instead of AIBackend |
| Modify | `packages/orchestrator/src/orchestrator.ts` | Accept AgentPlugin[] |
| Modify | `packages/orchestrator/src/index.ts` | Export agent module, remove AIBackend |
| Delete | `packages/orchestrator/src/ai-backend.ts` | Replaced by agent/types.ts |
| Delete | `apps/gateway/src/backends.ts` | Replaced by agents/ directory |

### Phase 5 — Notifier + PluginRegistry
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/orchestrator/src/notifier/types.ts` | Notifier, Notification, NotificationPriority |
| Create | `packages/orchestrator/src/notifier/websocket.ts` | WebSocket notifier (emit event) |
| Create | `packages/orchestrator/src/notifier/__tests__/websocket.test.ts` | Notifier tests |
| Create | `packages/orchestrator/src/notifier/index.ts` | Barrel exports |
| Create | `packages/orchestrator/src/plugin-registry.ts` | PluginRegistry class |
| Create | `packages/orchestrator/src/__tests__/plugin-registry.test.ts` | Registry tests |
| Modify | `packages/orchestrator/src/types.ts` | New OrchestratorOptions with registry |
| Modify | `packages/orchestrator/src/orchestrator.ts` | Use PluginRegistry |
| Modify | `packages/orchestrator/src/index.ts` | Export notifier + registry |
| Modify | `apps/gateway/src/index.ts` | Build registry, new createOrchestrator call |

---

## Phase 1: Reaction Engine

### Task 1.1: Reaction Types + Facades

**Files:**
- Create: `packages/orchestrator/src/reaction/types.ts`

- [ ] **Step 1: Create reaction/types.ts with all interfaces**

```typescript
// packages/orchestrator/src/reaction/types.ts

// Notification defined inline (moved to notifier/types.ts in Phase 5)
export interface Notification {
  title: string;
  message: string;
  priority: "urgent" | "action" | "warning" | "info";
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

// ── Triggers ──
export type ReactionTrigger =
  | "task:failed"
  | "review:fail"
  | "agent:stuck"
  | "agent:error"
  | "delegation:budget"
  | "task:done";

// ── Actions ──
export type ReactionAction =
  | "retry"
  | "send-to-agent"
  | "escalate-to-leader"
  | "notify"
  | "force-finalize";

// ── Facades (restricted access for the engine) ──
export interface AgentSessionFacade {
  prependTask(taskId: string, prompt: string): void;
  getAgentId(): string;
  getRole(): string;
}

export interface OrchestratorFacade {
  getTeamLead(): AgentSessionFacade | null;
  runTask(agentId: string, taskId: string, prompt: string): void;
  forceFinalize(agentId: string): void;
  emitNotification(notification: Notification): void;
}

// ── Context passed with every event ──
export interface ReactionContext {
  agentId: string;
  taskId: string;
  error?: string;
  role?: string;
  wasTimeout?: boolean;
  wasCancellation?: boolean;
  isDelegated?: boolean;
  isReviewer?: boolean;           // true for Code Reviewer agents (never retry)
  reviewerOutput?: string;
  devAgentId?: string;
  originalPrompt?: string;        // original task prompt (for escalation context)
  session: AgentSessionFacade;
  orchestrator: OrchestratorFacade;
}

// ── Rules ──
export interface ReactionMatch {
  role?: string;
  attempt?: { gte?: number };
  wasTimeout?: boolean;
  isDelegated?: boolean;
}

export interface ReactionRule {
  trigger: ReactionTrigger;
  match?: ReactionMatch;
  action: ReactionAction;
  retries?: number;
  escalateAction?: ReactionAction;
  thresholdMs?: number;
}

export interface ReactionEngineConfig {
  rules: ReactionRule[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/reaction/types.ts
git commit -m "feat(reaction): add reaction engine type definitions"
```

---

### Task 1.2: Default Rules

**Files:**
- Create: `packages/orchestrator/src/reaction/defaults.ts`

- [ ] **Step 1: Create defaults.ts with rules matching current behavior**

```typescript
// packages/orchestrator/src/reaction/defaults.ts
import type { ReactionRule } from "./types.js";

/**
 * Default reaction rules — preserve the exact behavior of:
 * - retry.ts (maxRetries: 2, escalateToLeader)
 * - delegation.ts (maxDirectFixes: 1, then escalate)
 * - config.ts (hardCeilingRounds: 10 → force-finalize)
 * - NEW: agent:stuck detection at 5 min
 */
export const DEFAULT_RULES: ReactionRule[] = [
  // Was: RetryTracker with maxRetries=2, escalateToLeader=true
  // Skip timeouts and cancellations (they won't benefit from retry)
  {
    trigger: "task:failed",
    match: { wasTimeout: false },
    action: "retry",
    retries: 2,
    escalateAction: "escalate-to-leader",
  },

  // Was: delegation.ts tryDirectFix() with maxDirectFixes=1
  // First FAIL → send to dev for direct fix, second FAIL → escalate to leader
  {
    trigger: "review:fail",
    action: "send-to-agent",
    retries: 1,
    escalateAction: "escalate-to-leader",
  },

  // Was: config.ts hardCeilingRounds=10 → synthetic task:done
  {
    trigger: "delegation:budget",
    action: "force-finalize",
  },

  // New: detect stuck agents (no output for 5 minutes)
  {
    trigger: "agent:stuck",
    thresholdMs: 300_000,
    action: "notify",
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/reaction/defaults.ts
git commit -m "feat(reaction): add default rules preserving existing behavior"
```

---

### Task 1.3: ReactionEngine Core

**Files:**
- Create: `packages/orchestrator/src/reaction/engine.ts`
- Create: `packages/orchestrator/src/reaction/__tests__/engine.test.ts`

- [ ] **Step 1: Write failing tests for engine**

```typescript
// packages/orchestrator/src/reaction/__tests__/engine.test.ts
import { describe, it, expect, vi } from "vitest";
import { ReactionEngine } from "../engine.js";
import { DEFAULT_RULES } from "../defaults.js";
import type { ReactionContext, AgentSessionFacade, OrchestratorFacade } from "../types.js";

function mockSession(overrides?: Partial<AgentSessionFacade>): AgentSessionFacade {
  return {
    prependTask: vi.fn(),
    getAgentId: vi.fn(() => "agent-1"),
    getRole: vi.fn(() => "Developer"),
    ...overrides,
  };
}

function mockOrchestrator(overrides?: Partial<OrchestratorFacade>): OrchestratorFacade {
  return {
    getTeamLead: vi.fn(() => null),
    runTask: vi.fn(),
    forceFinalize: vi.fn(),
    emitNotification: vi.fn(),
    ...overrides,
  };
}

function baseContext(overrides?: Partial<ReactionContext>): ReactionContext {
  return {
    agentId: "agent-1",
    taskId: "task-1",
    error: "some error",
    role: "Developer",
    wasTimeout: false,
    wasCancellation: false,
    isDelegated: false,
    session: mockSession(),
    orchestrator: mockOrchestrator(),
    ...overrides,
  };
}

describe("ReactionEngine", () => {
  it("retries a failed task on first attempt", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("retry");
    expect(ctx.session.prependTask).toHaveBeenCalled();
  });

  it("escalates to leader after retries exhausted", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const leadSession = mockSession({ getAgentId: vi.fn(() => "lead-1") });
    const orc = mockOrchestrator({ getTeamLead: vi.fn(() => leadSession) });
    const ctx = baseContext({ orchestrator: orc });

    // Exhaust retries (2 retries for task:failed rule)
    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("escalate-to-leader");
  });

  it("skips retry when wasTimeout is true", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ wasTimeout: true });
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("no-match");
  });

  it("skips retry for reviewer agents", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ isReviewer: true, role: "Code Reviewer" });
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("no-match");
  });

  it("skips retry for cancellations", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ wasCancellation: true });
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("no-match");
  });

  it("returns attempt count in result for retrying events", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();
    const result = engine.handle("task:failed", ctx);
    expect(result.attempt).toBe(1);
    expect(result.maxRetries).toBe(2);
  });

  it("resets state on reset()", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();
    engine.handle("task:failed", ctx);
    engine.reset();
    // After reset, first attempt again
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("retry");
    expect(result.attempt).toBe(1);
  });

  it("sends review:fail to dev agent for direct fix", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({
      role: "Code Reviewer",
      devAgentId: "dev-1",
      reviewerOutput: "VERDICT: FAIL\nIssues found...",
    });
    const result = engine.handle("review:fail", ctx);
    expect(result.action).toBe("send-to-agent");
  });

  it("force-finalizes on delegation:budget", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();
    const result = engine.handle("delegation:budget", ctx);
    expect(result.action).toBe("force-finalize");
    expect(ctx.orchestrator.forceFinalize).toHaveBeenCalled();
  });

  it("notifies on agent:stuck", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();
    const result = engine.handle("agent:stuck", ctx);
    expect(result.action).toBe("notify");
    expect(ctx.orchestrator.emitNotification).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/orchestrator && npx vitest run src/reaction/__tests__/engine.test.ts`
Expected: FAIL — ReactionEngine module not found

- [ ] **Step 3: Implement ReactionEngine**

```typescript
// packages/orchestrator/src/reaction/engine.ts
import type {
  ReactionTrigger,
  ReactionAction,
  ReactionRule,
  ReactionMatch,
  ReactionContext,
  ReactionEngineConfig,
} from "./types.js";

export interface ReactionResult {
  action: ReactionAction | "no-match";
  trigger: ReactionTrigger;
  ruleIndex?: number;
  /** Current attempt count (for task:retrying event) */
  attempt?: number;
  /** Max retries for this rule (for task:retrying event) */
  maxRetries?: number;
}

interface AttemptState {
  count: number;
  errors: string[];
}

/**
 * ReactionEngine — matches events to rules and executes actions.
 *
 * Tracks per-agent-task attempt counts AND error history for retry/escalation.
 * Stateful: call reset() between team sessions.
 */
export class ReactionEngine {
  private rules: ReactionRule[];
  /** Track attempts + error history per trigger+agentId+taskId */
  private attempts = new Map<string, AttemptState>();

  constructor(config: ReactionEngineConfig) {
    this.rules = config.rules;
  }

  private attemptKey(trigger: ReactionTrigger, ctx: ReactionContext): string {
    return `${trigger}:${ctx.agentId}:${ctx.taskId}`;
  }

  private getAttemptState(key: string): AttemptState {
    let state = this.attempts.get(key);
    if (!state) {
      state = { count: 0, errors: [] };
      this.attempts.set(key, state);
    }
    return state;
  }

  private matchesRule(rule: ReactionRule, ctx: ReactionContext): boolean {
    const m = rule.match;
    if (!m) return true;
    if (m.role !== undefined && ctx.role !== m.role) return false;
    if (m.wasTimeout !== undefined && ctx.wasTimeout !== m.wasTimeout) return false;
    if (m.isDelegated !== undefined && ctx.isDelegated !== m.isDelegated) return false;
    if (m.attempt?.gte !== undefined) {
      const key = this.attemptKey(rule.trigger, ctx);
      const state = this.attempts.get(key);
      if (!state || state.count < m.attempt.gte) return false;
    }
    return true;
  }

  handle(trigger: ReactionTrigger, ctx: ReactionContext): ReactionResult {
    // Never retry reviewer failures or cancellations
    if (trigger === "task:failed" && (ctx.isReviewer || ctx.wasCancellation)) {
      return { action: "no-match", trigger };
    }

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (rule.trigger !== trigger) continue;
      if (!this.matchesRule(rule, ctx)) continue;

      const key = this.attemptKey(trigger, ctx);
      const state = this.getAttemptState(key);
      const maxRetries = rule.retries ?? 0;

      // Record the error for history
      if (ctx.error) state.errors.push(ctx.error);

      if (state.count >= maxRetries && rule.escalateAction) {
        const errors = [...state.errors];
        this.attempts.delete(key);
        this.executeAction(rule.escalateAction, ctx, errors);
        return { action: rule.escalateAction, trigger, ruleIndex: i,
                 attempt: state.count, maxRetries };
      }

      state.count++;
      this.executeAction(rule.action, ctx);
      return { action: rule.action, trigger, ruleIndex: i,
               attempt: state.count, maxRetries };
    }

    return { action: "no-match", trigger };
  }

  private executeAction(action: ReactionAction, ctx: ReactionContext, errorHistory?: string[]): void {
    switch (action) {
      case "retry": {
        const key = this.attemptKey("task:failed", ctx);
        const state = this.attempts.get(key);
        const attempt = state?.count ?? 1;
        const maxRetries = this.rules.find(r => r.trigger === "task:failed")?.retries ?? 2;
        const retryPrompt = this.buildRetryPrompt(ctx, attempt, maxRetries);
        ctx.session.prependTask(ctx.taskId, retryPrompt);
        break;
      }
      case "send-to-agent": {
        if (ctx.devAgentId) {
          ctx.orchestrator.runTask(ctx.devAgentId, ctx.taskId, ctx.reviewerOutput ?? "Fix the issues");
        }
        break;
      }
      case "escalate-to-leader": {
        const lead = ctx.orchestrator.getTeamLead();
        if (lead && lead.getAgentId() !== ctx.agentId) {
          const prompt = this.buildEscalationPrompt(ctx, errorHistory ?? []);
          // Use a new taskId for escalation to avoid tracking conflicts
          const escalationTaskId = `escalation-${ctx.taskId}-${Date.now()}`;
          ctx.orchestrator.runTask(lead.getAgentId(), escalationTaskId, prompt);
        }
        break;
      }
      case "notify": {
        ctx.orchestrator.emitNotification({
          title: `Agent ${ctx.agentId} needs attention`,
          message: ctx.error ?? `Trigger: ${ctx.taskId}`,
          priority: "urgent",
          agentId: ctx.agentId,
          taskId: ctx.taskId,
        });
        break;
      }
      case "force-finalize": {
        ctx.orchestrator.forceFinalize(ctx.agentId);
        break;
      }
    }
  }

  private buildRetryPrompt(ctx: ReactionContext, attempt: number, maxRetries: number): string {
    const error = ctx.error ?? "unknown error";
    const original = ctx.originalPrompt ?? "";
    return `${original}

[RETRY — Attempt ${attempt}/${maxRetries}]
Previous attempt failed with:
${error.slice(0, 500)}

Before retrying, follow this protocol:
1. DIAGNOSE: Read the error carefully. Identify the root cause, not just the symptom.
2. FIX: Address the root cause first (missing dependency, wrong path, syntax error, etc.)
3. VERIFY: After fixing, confirm the fix works before moving on.
Do NOT repeat the same approach that failed.`;
  }

  private buildEscalationPrompt(ctx: ReactionContext, errorHistory: string[]): string {
    const errorList = errorHistory.map((e, i) => `  Attempt ${i + 1}: ${e.slice(0, 200)}`).join("\n");
    const sameError = errorHistory.length >= 2 && errorHistory.every(e =>
      e.slice(0, 80).toLowerCase() === errorHistory[0].slice(0, 80).toLowerCase()
    );

    return `[ESCALATION] A task has failed after ${errorHistory.length} attempts and needs your decision.

Original task: "${(ctx.originalPrompt ?? ctx.error ?? "").slice(0, 300)}"

Failure history:
${errorList}
${sameError ? "\nAll attempts failed with the SAME error. This is likely a PERMANENT blocker (missing credentials, API limits, service unavailable). Do NOT reassign — report to user.\n" : ""}
Options (choose ONE):
1. If the error is FIXABLE (code bug, wrong path): Reassign to a DIFFERENT team member with revised instructions
2. If the task is too large: Break into smaller pieces and delegate each part
3. If the error is PERMANENT (auth failure, service down, insufficient balance, missing API key): Report the blocker to the user. Do NOT reassign.

IMPORTANT: If the same error keeps repeating, choose option 3. Do not waste resources retrying.`;
  }

  /** Reset attempt counters (call between team sessions) */
  reset(): void {
    this.attempts.clear();
  }

  /** Clear tracking for a specific task */
  clearTask(taskId: string): void {
    for (const key of this.attempts.keys()) {
      if (key.endsWith(`:${taskId}`)) {
        this.attempts.delete(key);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/orchestrator && npx vitest run src/reaction/__tests__/engine.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/reaction/engine.ts packages/orchestrator/src/reaction/__tests__/engine.test.ts
git commit -m "feat(reaction): implement ReactionEngine with rule matching and action execution"
```

---

### Task 1.4: Barrel Exports + New Event Types

**Files:**
- Create: `packages/orchestrator/src/reaction/index.ts`
- Modify: `packages/orchestrator/src/types.ts`

- [ ] **Step 1: Create reaction/index.ts**

```typescript
// packages/orchestrator/src/reaction/index.ts
export { ReactionEngine } from "./engine.js";
export type { ReactionResult } from "./engine.js";
export { DEFAULT_RULES } from "./defaults.js";
export type {
  ReactionTrigger,
  ReactionAction,
  ReactionRule,
  ReactionMatch,
  ReactionContext,
  ReactionEngineConfig,
  AgentSessionFacade,
  OrchestratorFacade,
  Notification,
} from "./types.js";
```

- [ ] **Step 2: Add ReviewFailEvent and NotificationEvent to types.ts**

Add after `AutoMergeUpdatedEvent` (around line 204):

```typescript
export interface ReviewFailEvent {
  type: "review:fail";
  agentId: string;
  taskId: string;
  reviewerOutput: string;
  devAgentId?: string;
}

export interface NotificationEvent {
  type: "notification";
  title: string;
  message: string;
  priority: "urgent" | "action" | "warning" | "info";
  agentId?: string;
  taskId?: string;
}
```

Add to `OrchestratorEvent` union:

```typescript
  | ReviewFailEvent
  | NotificationEvent;
```

Add to `OrchestratorEventMap`:

```typescript
  "review:fail": [ReviewFailEvent];
  "notification": [NotificationEvent];
```

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/reaction/index.ts packages/orchestrator/src/types.ts
git commit -m "feat(reaction): add barrel exports and new event types (ReviewFail, Notification)"
```

---

### Task 1.5: Wire ReactionEngine into Orchestrator

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`

This is the largest task — replace the retry logic in `orchestrator.ts` with ReactionEngine calls.

- [ ] **Step 1: Add ReactionEngine to Orchestrator constructor**

In `orchestrator.ts`, replace:
```typescript
import { RetryTracker } from "./retry.js";
```
with:
```typescript
import { ReactionEngine, DEFAULT_RULES } from "./reaction/index.js";
import type { ReactionContext, AgentSessionFacade, OrchestratorFacade } from "./reaction/index.js";
```

Replace property:
```typescript
private retryTracker: RetryTracker | null;
```
with:
```typescript
private reactionEngine: ReactionEngine;
```

In constructor, replace:
```typescript
if (opts.retry === false) {
  this.retryTracker = null;
} else {
  const r = opts.retry ?? {};
  this.retryTracker = new RetryTracker(r.maxRetries, r.escalateToLeader);
}
```
with:
```typescript
this.reactionEngine = new ReactionEngine({
  rules: opts.reactions ?? DEFAULT_RULES,
});
```

- [ ] **Step 2: Add facade builder methods to Orchestrator**

Add private methods:

```typescript
private buildSessionFacade(session: AgentSession): AgentSessionFacade {
  return {
    prependTask: (taskId, prompt) => session.prependTask(taskId, prompt),
    getAgentId: () => session.agentId,
    getRole: () => session.role ?? "",
  };
}

private buildOrchestratorFacade(): OrchestratorFacade {
  return {
    getTeamLead: () => {
      const leadId = this.agentManager.getTeamLead();
      if (!leadId) return null;
      const leadSession = this.agentManager.get(leadId);
      return leadSession ? this.buildSessionFacade(leadSession) : null;
    },
    runTask: (agentId, taskId, prompt) => this.runTask(agentId, taskId, prompt),
    forceFinalize: (agentId) => {
      const session = this.agentManager.get(agentId);
      if (session) {
        this.emitEvent({ type: "task:done", agentId, taskId: "forced", result: {
          summary: "Force-finalized by reaction engine (budget exceeded)",
          changedFiles: [], diffStat: "", testResult: "unknown",
        }, isFinalResult: true });
      }
    },
    emitNotification: (notification) => {
      this.emitEvent({ type: "notification", ...notification });
    },
  };
}
```

- [ ] **Step 3: Replace retry handling in _handleSessionEventUnsafe**

Find the `task:failed` block (around line 853) and replace the entire retry/escalation logic with:

```typescript
if (event.type === "task:failed") {
  const taskId = event.taskId;
  const session = this.agentManager.get(agentId);
  if (session) {
    const isReviewer = session.role?.toLowerCase().includes("review") ?? false;
    const ctx: ReactionContext = {
      agentId,
      taskId,
      error: event.error,
      role: session.role,
      wasTimeout: session.wasTimeout ?? false,
      wasCancellation: event.error === "Task cancelled by user",
      isDelegated: this.delegationRouter.isDelegated(taskId),
      isReviewer,
      originalPrompt: session.lastPrompt,
      session: this.buildSessionFacade(session),
      orchestrator: this.buildOrchestratorFacade(),
    };
    const result = this.reactionEngine.handle("task:failed", ctx);
    if (result.action === "retry") {
      this.emitEvent({
        type: "task:retrying",
        agentId,
        taskId,
        attempt: result.attempt ?? 1,
        maxRetries: result.maxRetries ?? 2,
        error: event.error,
      });
      return; // Don't emit task:failed — we're retrying
    }
  }
}
```

- [ ] **Step 4: Replace retryTracker.track() and retryTracker.clear() calls**

Search for all `this.retryTracker?.track(` and remove them.
Search for all `this.retryTracker?.clear(` and replace with `this.reactionEngine.clearTask(event.taskId)`.

- [ ] **Step 5: Update OrchestratorOptions in types.ts**

Add to `OrchestratorOptions`:

```typescript
/** Reaction rules. Defaults to DEFAULT_RULES if not specified. */
reactions?: import("./reaction/types.js").ReactionRule[];
```

- [ ] **Step 6: Update index.ts exports**

Remove:
```typescript
export { RetryTracker } from "./retry.js";
```

Add:
```typescript
export { ReactionEngine, DEFAULT_RULES } from "./reaction/index.js";
export type { ReactionTrigger, ReactionAction, ReactionRule, ReactionContext, ReactionEngineConfig } from "./reaction/index.js";
```

- [ ] **Step 7: Delete retry.ts**

```bash
rm packages/orchestrator/src/retry.ts
```

- [ ] **Step 8: Build and verify no type errors**

Run: `cd packages/orchestrator && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Run existing tests to verify no regressions**

Run: `cd packages/orchestrator && npx vitest run`
Expected: All tests pass (or adapt tests that import RetryTracker)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(reaction): wire ReactionEngine into orchestrator, remove RetryTracker"
```

---

### Task 1.6: Emit review:fail from DelegationRouter

**Files:**
- Modify: `packages/orchestrator/src/delegation.ts`

- [ ] **Step 1: Make DelegationRouter emit review:fail event**

In `delegation.ts`, find `tryDirectFix()` method. After the VERDICT:FAIL regex match (line ~433-434), instead of handling the direct fix inline, emit a `review:fail` event and let the ReactionEngine handle it:

The `emitEvent` callback is already passed to the constructor. Add to the VERDICT:FAIL detection block:

Note: Task 1.4 must be completed first (adds `ReviewFailEvent` to the event union).

```typescript
// After: if (!verdictMatch || verdictMatch[1].toUpperCase() !== "FAIL") return false;
this.emitEvent({
  type: "review:fail",
  agentId: reviewerAgentId,
  taskId: /* current task ID */,
  reviewerOutput: output,
  devAgentId: devAgentId,
});
```

Remove the `devFixAttempts` Map and its usage. The ReactionEngine now tracks attempts via its internal `attempts` map.

- [ ] **Step 2: Remove devFixAttempts from clearAll()**

Find `this.devFixAttempts.clear()` in `clearAll()` and remove it.

- [ ] **Step 3: Build and verify**

Run: `cd packages/orchestrator && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/delegation.ts
git commit -m "refactor(delegation): emit review:fail event, remove devFixAttempts"
```

---

### Task 1.7: Slim down config.ts

**Files:**
- Modify: `packages/orchestrator/src/config.ts`

- [ ] **Step 1: Remove retry-related constants from CONFIG**

Remove from `CONFIG.delegation`:
- `maxReviewRounds` (now in DEFAULT_RULES `review:fail` retries)
- `maxDirectFixes` (now in DEFAULT_RULES `review:fail` retries)
- `hardCeilingRounds` (now `delegation:budget` rule)

Keep: `maxDepth`, `maxTotal`, `budgetRounds` (these are delegation bookkeeping, not reactions).

- [ ] **Step 2: Search for removed constant references and update**

Run: `grep -rn "CONFIG.delegation.maxReviewRounds\|CONFIG.delegation.maxDirectFixes\|CONFIG.delegation.hardCeilingRounds" packages/orchestrator/src/`

Update each reference to use the reaction engine instead.

- [ ] **Step 3: Build and verify**

Run: `cd packages/orchestrator && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/config.ts
git commit -m "refactor(config): remove retry/review constants (moved to reaction defaults)"
```

---

## Phase 2: Workspace Abstraction

### Task 2.1: Workspace Types

**Files:**
- Create: `packages/orchestrator/src/workspace/types.ts`

- [ ] **Step 1: Create workspace/types.ts**

Copy the interface definitions directly from the spec (Section 2, Interface block). Include all types: `WorkspaceInfo`, `WorkspaceCreateConfig`, `WorkspaceMergeResult`, `RevertResult`, `Workspace`, `PostCreateConfig`. Import `WorktreeOwnerInfo` and `CleanupWorktreeOptions` from the existing worktree.ts (they move with it).

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/workspace/types.ts
git commit -m "feat(workspace): add Workspace interface definitions"
```

---

### Task 2.2: PostCreate Implementation

**Files:**
- Create: `packages/orchestrator/src/workspace/post-create.ts`
- Create: `packages/orchestrator/src/workspace/__tests__/post-create.test.ts`

- [ ] **Step 1: Write failing tests for postCreate**

```typescript
// packages/orchestrator/src/workspace/__tests__/post-create.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPostCreate } from "../post-create.js";
import type { WorkspaceInfo, PostCreateConfig } from "../types.js";

describe("runPostCreate", () => {
  it("rejects symlink paths with ..", async () => {
    const info: WorkspaceInfo = { path: "/tmp/ws", branch: "main", agentId: "a1" };
    const config: PostCreateConfig = { symlinks: ["../../etc/passwd"] };
    // Should log warning but not throw
    await expect(runPostCreate(info, "/repo", config)).resolves.not.toThrow();
  });

  it("rejects absolute symlink paths", async () => {
    const info: WorkspaceInfo = { path: "/tmp/ws", branch: "main", agentId: "a1" };
    const config: PostCreateConfig = { symlinks: ["/etc/passwd"] };
    await expect(runPostCreate(info, "/repo", config)).resolves.not.toThrow();
  });

  it("continues on command failure", async () => {
    const info: WorkspaceInfo = { path: "/tmp/ws", branch: "main", agentId: "a1" };
    const config: PostCreateConfig = { commands: ["false"] }; // always fails
    await expect(runPostCreate(info, "/repo", config)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/orchestrator && npx vitest run src/workspace/__tests__/post-create.test.ts`

- [ ] **Step 3: Implement runPostCreate**

```typescript
// packages/orchestrator/src/workspace/post-create.ts
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceInfo, PostCreateConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export async function runPostCreate(
  info: WorkspaceInfo,
  repoRoot: string,
  config: PostCreateConfig,
): Promise<void> {
  // Symlinks
  if (config.symlinks) {
    for (const symlinkPath of config.symlinks) {
      if (symlinkPath.startsWith("/") || symlinkPath.includes("..")) {
        console.warn(`[Workspace postCreate] Rejected symlink "${symlinkPath}": must be relative without ".." segments`);
        continue;
      }
      const sourcePath = join(repoRoot, symlinkPath);
      const targetPath = resolve(info.path, symlinkPath);
      if (!targetPath.startsWith(info.path + "/") && targetPath !== info.path) {
        console.warn(`[Workspace postCreate] Rejected symlink "${symlinkPath}": resolves outside workspace`);
        continue;
      }
      if (!existsSync(sourcePath)) continue;
      try {
        const stat = lstatSync(targetPath);
        if (stat.isSymbolicLink() || stat.isFile() || stat.isDirectory()) {
          rmSync(targetPath, { recursive: true, force: true });
        }
      } catch { /* target doesn't exist */ }
      mkdirSync(dirname(targetPath), { recursive: true });
      try {
        symlinkSync(sourcePath, targetPath);
      } catch (err) {
        console.warn(`[Workspace postCreate] Failed to symlink ${symlinkPath}: ${(err as Error).message}`);
      }
    }
  }

  // Commands
  if (config.commands) {
    for (const command of config.commands) {
      try {
        await execFileAsync("sh", ["-c", command], { cwd: info.path, timeout: 120_000 });
      } catch (err) {
        console.warn(`[Workspace postCreate] Command failed: "${command}": ${(err as Error).message}`);
        // Continue — don't fail workspace creation
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/orchestrator && npx vitest run src/workspace/__tests__/post-create.test.ts`
Expected: All 3 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/workspace/post-create.ts packages/orchestrator/src/workspace/__tests__/post-create.test.ts
git commit -m "feat(workspace): implement postCreate with symlinks and commands"
```

---

### Task 2.3: WorktreeWorkspace Class

**Files:**
- Create: `packages/orchestrator/src/workspace/worktree.ts`
- Modify (move): `packages/orchestrator/src/worktree.ts` → delete after migration

- [ ] **Step 1: Create workspace/worktree.ts as class wrapping existing functions**

Create `WorktreeWorkspace` class that `implements Workspace`. Import all existing functions from `../worktree.js` and wrap them as methods. Each method delegates to the existing function with matching parameters.

Key pattern:

```typescript
// packages/orchestrator/src/workspace/worktree.ts
import type { Workspace, WorkspaceCreateConfig, WorkspaceInfo, WorkspaceMergeResult, RevertResult, PostCreateConfig } from "./types.js";
import type { CleanupWorktreeOptions } from "../worktree.js";
import {
  createWorktree as _createWorktree,
  mergeWorktree as _mergeWorktree,
  removeWorktree as _removeWorktree,
  syncWorktreeToMain as _syncWorktreeToMain,
  revertWorktreeCommit as _revertWorktreeCommit,
  undoMergeCommit as _undoMergeCommit,
  worktreeHasPendingChanges as _worktreeHasPendingChanges,
  checkConflicts as _checkConflicts,
  cleanupStaleWorktrees as _cleanupStaleWorktrees,
  getManagedWorktreeBranch,
} from "../worktree.js";
import { runPostCreate } from "./post-create.js";

export class WorktreeWorkspace implements Workspace {
  readonly name = "worktree";
  private postCreateConfig?: PostCreateConfig;

  constructor(opts?: { postCreate?: PostCreateConfig }) {
    this.postCreateConfig = opts?.postCreate;
  }

  create(config: WorkspaceCreateConfig): WorkspaceInfo | null {
    const path = _createWorktree(config.repoRoot, config.agentId, config.agentName, config.owner);
    if (!path) return null;
    const branch = getManagedWorktreeBranch(config.agentName, config.agentId);
    const info: WorkspaceInfo = { path, branch, agentId: config.agentId };
    if (this.postCreateConfig) {
      // Fire and forget — errors logged but don't block
      runPostCreate(info, config.repoRoot, this.postCreateConfig).catch((err) =>
        console.warn("[Workspace postCreate] Unexpected error:", err));
    }
    return info;
  }

  destroy(repoRoot: string, worktreePath: string, branch: string): void {
    _removeWorktree(worktreePath, branch, repoRoot);
  }

  sync(repoRoot: string, worktreePath: string): void {
    _syncWorktreeToMain(repoRoot, worktreePath);
  }

  merge(repoRoot: string, worktreePath: string, branch: string, opts?: { keepAlive?: boolean; summary?: string; agentName?: string; agentId?: string }): WorkspaceMergeResult {
    return _mergeWorktree(repoRoot, worktreePath, branch, opts?.keepAlive, opts?.summary, opts?.agentName);
  }

  revert(repoRoot: string, worktreePath: string): RevertResult {
    return _revertWorktreeCommit(repoRoot, worktreePath);
  }

  undoMerge(repoRoot: string, commitHash: string): { success: boolean; message?: string } {
    return _undoMergeCommit(repoRoot, commitHash);
  }

  hasPendingChanges(repoRoot: string, worktreePath: string): boolean {
    return _worktreeHasPendingChanges(repoRoot, worktreePath);
  }

  checkConflicts(repoRoot: string, branch: string): string[] {
    return _checkConflicts(repoRoot, branch);
  }

  cleanup(repoRoot: string, activeBranches: Set<string>, options?: CleanupWorktreeOptions) {
    return _cleanupStaleWorktrees(repoRoot, activeBranches, options);
  }
}
```

This is a **thin adapter** — all logic stays in the original `worktree.ts` file for now. The class just wraps functions into the interface shape. In a future step, we move the logic into the class and delete the original file.

- [ ] **Step 2: Create workspace/index.ts**

```typescript
export { WorktreeWorkspace } from "./worktree.js";
export { runPostCreate } from "./post-create.js";
export type { Workspace, WorkspaceInfo, WorkspaceCreateConfig, WorkspaceMergeResult, RevertResult, PostCreateConfig } from "./types.js";
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/orchestrator && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/workspace/
git commit -m "feat(workspace): add WorktreeWorkspace adapter class wrapping existing functions"
```

---

### Task 2.4: Wire Workspace into Orchestrator

**Files:**
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Add Workspace to orchestrator constructor**

Import and use `WorktreeWorkspace` in the orchestrator. Replace direct worktree function calls with `this.workspace.method()` calls.

This is a search-and-replace task across `orchestrator.ts`:
- `createWorktree(...)` → `this.workspace.create(...)`
- `mergeWorktree(...)` → `this.workspace.merge(...)`
- `removeWorktree(...)` → `this.workspace.destroy(...)`
- `syncWorktreeToMain(...)` → `this.workspace.sync(...)`
- etc.

- [ ] **Step 2: Update index.ts exports**

Add workspace exports:
```typescript
export { WorktreeWorkspace } from "./workspace/index.js";
export type { Workspace, WorkspaceInfo, PostCreateConfig } from "./workspace/index.js";
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/orchestrator && npx tsc --noEmit`

- [ ] **Step 4: Run full test suite**

Run: `cd packages/orchestrator && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(workspace): wire WorktreeWorkspace into orchestrator"
```

---

## Phase 3: Task Decomposer

### Task 3.1: Decomposer Types

**Files:**
- Create: `packages/orchestrator/src/decomposer/types.ts`

- [ ] **Step 1: Create types.ts with TaskNode, DecompositionPlan, DecomposerConfig**

Copy directly from spec Section 3. Include `TaskKind`, `TaskStatus`, `TaskNode` (with `parentId`), `DecompositionPlan`, `DecomposerConfig`.

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/decomposer/types.ts
git commit -m "feat(decomposer): add task decomposer type definitions"
```

---

### Task 3.2: Context Formatting

**Files:**
- Create: `packages/orchestrator/src/decomposer/context.ts`
- Create: `packages/orchestrator/src/decomposer/__tests__/context.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { formatLineage, formatSiblings } from "../context.js";

describe("formatLineage", () => {
  it("formats a single-level hierarchy", () => {
    const result = formatLineage(["Build a snake game"], "Implement movement");
    expect(result).toContain("0. Build a snake game");
    expect(result).toContain("1. Implement movement");
    expect(result).toContain("<-- (this task)");
  });
});

describe("formatSiblings", () => {
  it("formats sibling tasks", () => {
    const result = formatSiblings(["Add scoring", "Add collision"], "Add scoring");
    expect(result).toContain("Add scoring  <-- (you)");
    expect(result).toContain("Add collision");
  });

  it("returns empty string for no siblings", () => {
    expect(formatSiblings([], "task")).toBe("");
  });
});
```

- [ ] **Step 2: Implement context.ts**

```typescript
export function formatLineage(lineage: string[], current: string): string {
  const parts = lineage.map((desc, i) => `${"  ".repeat(i)}${i}. ${desc}`);
  parts.push(`${"  ".repeat(lineage.length)}${lineage.length}. ${current}  <-- (this task)`);
  return parts.join("\n");
}

export function formatSiblings(siblings: string[], current: string): string {
  if (siblings.length === 0) return "";
  const lines = siblings.map((s) => (s === current ? `  - ${s}  <-- (you)` : `  - ${s}`));
  return `Sibling tasks being worked on in parallel:\n${lines.join("\n")}`;
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

```bash
git add packages/orchestrator/src/decomposer/context.ts packages/orchestrator/src/decomposer/__tests__/context.test.ts
git commit -m "feat(decomposer): add lineage and siblings context formatting"
```

---

### Task 3.3: Decomposition Parser

**Files:**
- Create: `packages/orchestrator/src/decomposer/parser.ts`
- Create: `packages/orchestrator/src/decomposer/__tests__/parser.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of `[DECOMPOSITION]...[/DECOMPOSITION]` blocks from Leader output. Test: valid block, missing block (returns null), malformed JSON, missing task IDs in groups.

- [ ] **Step 2: Implement parser.ts**

Regex extraction of the block, JSON.parse, validation, conversion to TaskNode tree based on `groups` field.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(decomposer): implement [DECOMPOSITION] block parser"
```

---

### Task 3.4: Scheduler

**Files:**
- Create: `packages/orchestrator/src/decomposer/scheduler.ts`
- Create: `packages/orchestrator/src/decomposer/__tests__/scheduler.test.ts`

- [ ] **Step 1: Write failing tests for group-based dispatch**

Test: single group dispatches all tasks, multi-group waits for completion, failed task propagates status.

- [ ] **Step 2: Implement scheduler.ts**

The scheduler holds a `DecompositionPlan`, dispatches groups sequentially, and calls a provided `dispatch(taskNode)` callback for each task. It listens for completion/failure events to advance groups.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(decomposer): implement group-based task scheduler"
```

---

### Task 3.5: Wire Decomposer + Barrel Exports

**Files:**
- Create: `packages/orchestrator/src/decomposer/index.ts`
- Modify: `packages/orchestrator/src/output-parser.ts`
- Modify: `packages/orchestrator/src/prompt-templates.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Create barrel exports**
- [ ] **Step 2: Add [DECOMPOSITION] detection to output-parser.ts**
- [ ] **Step 3: Add lineage/siblings template variables to prompt-templates.ts**
- [ ] **Step 4: Build, test, commit**

```bash
git commit -m "feat(decomposer): wire parser into output-parser, add lineage to prompts"
```

---

## Phase 4: Agent Plugin

### Task 4.1: AgentPlugin Interface

**Files:**
- Create: `packages/orchestrator/src/agent/types.ts`
- Create: `packages/orchestrator/src/agent/index.ts`

- [ ] **Step 1: Create agent/types.ts with AgentPlugin interface**

Copy from spec Section 4. Include `AgentPlugin`, `ActivityState`, `AgentSessionRef`, `AgentSessionInfo`, `WorkspaceHooksConfig`. Re-export `BuildArgsOpts`, `BackendStability`, `GuardType` from the existing `ai-backend.ts` types (so downstream code keeps working).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(agent): add AgentPlugin interface definitions"
```

---

### Task 4.2: Migrate Backends to AgentPlugin Files

**Files:**
- Create: `apps/gateway/src/agents/claude-code.ts`
- Create: `apps/gateway/src/agents/codex.ts`
- Create: `apps/gateway/src/agents/gemini.ts`
- Create: `apps/gateway/src/agents/common.ts`
- Create: `apps/gateway/src/agents/index.ts`

- [ ] **Step 1: Create common.ts with shared helpers**

Extract version-probe detection and `ensureClaudeSettingsForRoot()` from current `backends.ts`.

- [ ] **Step 2: Create claude-code.ts**

Convert the Claude Code object from `backends.ts` into a function `createClaudeCodeAgent(): AgentPlugin`. Include `detectActivity()` stub (returns null for now) and `capabilities` object.

- [ ] **Step 3: Create codex.ts and gemini.ts**

Same pattern — one file per backend, converting the object literal to an `AgentPlugin` factory function.

- [ ] **Step 4: Create index.ts with detectAndRegister()**

```typescript
export function detectAndRegister(registry: PluginRegistry): void {
  // Probe for installed CLIs, register what's found
}
```

- [ ] **Step 5: Build, verify, commit**

```bash
git commit -m "feat(agent): migrate backends to per-file AgentPlugin implementations"
```

---

### Task 4.3: Wire AgentPlugin into Orchestrator + Session

**Files:**
- Modify: `packages/orchestrator/src/agent-session.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Delete: `packages/orchestrator/src/ai-backend.ts`
- Delete: `apps/gateway/src/backends.ts`

- [ ] **Step 1: Update agent-session.ts to use AgentPlugin**

Replace `AIBackend` import with `AgentPlugin`. The method signatures are compatible (superset).

- [ ] **Step 2: Update orchestrator.ts**

Replace `backends: Map<string, AIBackend>` with `agents: Map<string, AgentPlugin>`.

- [ ] **Step 3: Delete ai-backend.ts and backends.ts**
- [ ] **Step 4: Update index.ts exports**
- [ ] **Step 5: Build, test, commit**

```bash
git commit -m "feat(agent): wire AgentPlugin into orchestrator, delete AIBackend"
```

---

## Phase 5: Notifier + PluginRegistry

### Task 5.1: Notifier Types + WebSocket Notifier

**Files:**
- Create: `packages/orchestrator/src/notifier/types.ts`
- Create: `packages/orchestrator/src/notifier/websocket.ts`
- Create: `packages/orchestrator/src/notifier/index.ts`

- [ ] **Step 1: Create notifier types (from reaction/types.ts Notification, make canonical)**

Move the `Notification` type from `reaction/types.ts` to `notifier/types.ts` and re-export.

- [ ] **Step 2: Create websocket notifier**

```typescript
import type { Notifier, Notification } from "./types.js";

export function createWebSocketNotifier(
  emitEvent: (event: any) => void,
): Notifier {
  return {
    name: "websocket",
    async send(notification: Notification): Promise<void> {
      emitEvent({ type: "notification", ...notification });
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(notifier): add Notifier interface and WebSocket implementation"
```

---

### Task 5.2: PluginRegistry

**Files:**
- Create: `packages/orchestrator/src/plugin-registry.ts`
- Create: `packages/orchestrator/src/__tests__/plugin-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Test register/get/getDefault/list operations for each slot type.

- [ ] **Step 2: Implement PluginRegistry**

Simple Map-based implementation per spec.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(registry): implement lightweight PluginRegistry"
```

---

### Task 5.3: New Orchestrator Construction API

**Files:**
- Modify: `packages/orchestrator/src/types.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/gateway/src/index.ts`

- [ ] **Step 1: Update OrchestratorOptions to accept PluginRegistry**

```typescript
export interface OrchestratorOptions {
  workspace: string;
  registry: PluginRegistry;
  defaultAgent?: string;
  defaultWorkspace?: string;
  worktree?: WorktreeOptions | false;
  reactions?: ReactionRule[];
  decomposer?: DecomposerConfig;
  promptsDir?: string;
  sandboxMode?: "full" | "safe";
}
```

- [ ] **Step 2: Update Orchestrator constructor to use registry**

Pull agents and workspace from registry instead of direct parameters.

- [ ] **Step 3: Update gateway index.ts to build registry**

Replace the old `backends` array construction with registry-based setup.

- [ ] **Step 4: Build, run full test suite, verify gateway starts**

Run: `pnpm dev:gateway` and verify it starts without errors.

- [ ] **Step 5: Final commit**

```bash
git commit -m "feat(registry): new orchestrator construction API with PluginRegistry"
```
