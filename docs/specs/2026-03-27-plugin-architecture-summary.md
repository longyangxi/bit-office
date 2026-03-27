# Plugin Architecture — Post-Refactor Summary

**Date**: 2026-03-27
**Branch**: `refactor/plugin-architecture-impl`
**Tests**: 51 passing
**Status**: Phase 1-5 infrastructure complete. Execution wiring pending (see "What's Next").

---

## Architecture Overview

```
                        +-----------------------+
                        |    Orchestrator        |
                        |  (EventEmitter)        |
                        +-----------+-----------+
                                    |
          +--------+--------+-------+-------+--------+--------+
          |        |        |       |       |        |        |
     Reaction  Workspace  Agent  Decomp  Notifier  Plugin   Legacy
     Engine    Adapter    Plugin  oser    (WS)     Registry (kept)
          |        |        |       |       |        |        |
     rules +   Worktree  Claude  Parser  emit()  register  Delegation
     match +   PostCreate Codex  Sched.          get       Phase
     action    Symlinks   Gemini Context         list      Memory
               Commands   ...9                             Preview
```

---

## Module Map

### 1. Reaction Engine (`packages/orchestrator/src/reaction/`)

**Purpose**: Configurable event → action → escalation automation. Replaces hardcoded `retry.ts`.

**Files**:
| File | Lines | Responsibility |
|------|-------|---------------|
| `types.ts` | 74 | ReactionTrigger, ReactionAction, ReactionRule, ReactionContext, facades |
| `engine.ts` | ~170 | Rule matching, action execution, attempt tracking, error history |
| `defaults.ts` | 42 | DEFAULT_RULES (preserves old retry/review/budget behavior) |
| `index.ts` | 15 | Barrel exports |

**How it works**:
```
Orchestrator event (task:failed, review:fail, agent:stuck, delegation:budget)
    |
    v
Orchestrator builds ReactionContext {
    agentId, taskId, error, role, wasTimeout, wasCancellation,
    isDelegated, isReviewer, originalPrompt,
    session: AgentSessionFacade,      // prependTask, getAgentId, getRole
    orchestrator: OrchestratorFacade  // getTeamLead, runTask, forceFinalize, emitNotification
}
    |
    v
ReactionEngine.handle(trigger, context)
    |
    v
Match rules: trigger match → condition match (role, wasTimeout, isDelegated, attempt count)
    |
    ├─ retries remaining → execute action (retry / send-to-agent / notify / force-finalize)
    └─ retries exhausted → execute escalateAction (escalate-to-leader)
```

**Default rules** (preserving old behavior):
```typescript
[
  // task:failed → retry 2x, then escalate to leader (skip timeout/delegated/reviewer)
  { trigger: "task:failed", match: { wasTimeout: false, isDelegated: false }, action: "retry", retries: 2, escalateAction: "escalate-to-leader" },

  // review:fail → send to dev 1x, then escalate to leader
  { trigger: "review:fail", action: "send-to-agent", retries: 1, escalateAction: "escalate-to-leader" },

  // delegation:budget → force-finalize
  { trigger: "delegation:budget", action: "force-finalize" },

  // agent:stuck → notify (5 min threshold)
  { trigger: "agent:stuck", thresholdMs: 300_000, action: "notify" },
]
```

**Key design decisions**:
- Engine receives facades (not raw session/orchestrator) for controlled access
- Error history preserved for same-error detection in escalation prompts
- `review:fail` is emitted by DelegationRouter (VERDICT parsing stays there)
- Memory recording stays in orchestrator listeners (not in engine)
- Escalation creates new taskId to avoid tracking conflicts

**Wiring point**: `orchestrator.ts` `_handleSessionEventUnsafe()` — on `task:failed`, builds context and calls `engine.handle()`. Returns early on retry (suppresses the failed event).

---

### 2. Workspace Abstraction (`packages/orchestrator/src/workspace/`)

**Purpose**: Pluggable git isolation with postCreate hooks. Wraps `worktree.ts`.

**Files**:
| File | Lines | Responsibility |
|------|-------|---------------|
| `types.ts` | 85 | Workspace interface, WorkspaceInfo, PostCreateConfig |
| `worktree.ts` | ~90 | WorktreeWorkspace — thin adapter over existing worktree.ts functions |
| `post-create.ts` | ~65 | Symlink creation + shell command execution |
| `index.ts` | 8 | Barrel exports |

**Interface**:
```typescript
interface Workspace {
  readonly name: string;
  create(config: WorkspaceCreateConfig): WorkspaceInfo | null;
  destroy(repoRoot, worktreePath, branch): void;
  sync(repoRoot, worktreePath): void;
  merge(repoRoot, worktreePath, branch, opts?): WorkspaceMergeResult;
  revert(repoRoot, worktreePath): RevertResult;
  undoMerge(repoRoot, commitHash): { success, message? };
  hasPendingChanges(repoRoot, worktreePath): boolean;
  checkConflicts(repoRoot, branch): string[];
  cleanup(repoRoot, activeBranches, options?): { removedBranches, removedWorktrees };
  postCreate?(info, repoRoot, config): Promise<void>;
}
```

**PostCreate hooks**:
```typescript
// Configured in OrchestratorOptions
workspace: {
  mergeOnComplete: true,
  alwaysIsolate: true,
  postCreate: {
    symlinks: [".env", ".claude"],        // from main repo → worktree
    commands: ["pnpm install --frozen-lockfile"],  // run after creation
  },
}
```

Security:
- Symlinks: no absolute paths, no `..`, resolved path must stay within workspace
- Commands: from trusted config only (never from agent output)
- Errors: logged as warnings, never fail workspace creation

**Wiring point**: `orchestrator.ts` uses `this.workspaceAdapter.*` for all worktree operations. Property name is `workspaceAdapter` (not `workspace`, which is the workspace path string).

**Note**: Original `worktree.ts` (932 lines) is kept as the underlying implementation. `WorktreeWorkspace` is a thin adapter. The worktree.ts functions are still directly exported from index.ts for backward compat with gateway.

---

### 3. Task Decomposer (`packages/orchestrator/src/decomposer/`)

**Purpose**: Structured task breakdown with lineage context. Parses Leader output into dispatchable task trees.

**Files**:
| File | Lines | Responsibility |
|------|-------|---------------|
| `types.ts` | 65 | TaskNode, DecompositionPlan, DecomposerConfig |
| `parser.ts` | ~85 | Extract [DECOMPOSITION] block from Leader output → TaskNode tree |
| `scheduler.ts` | ~130 | Group-based dispatch, status propagation, completion tracking |
| `context.ts` | 20 | formatLineage(), formatSiblings() |
| `index.ts` | 15 | Barrel exports |

**[DECOMPOSITION] block format** (Leader outputs this):
```
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
```

- `tasks`: flat list with explicit string IDs and roles
- `groups`: ordered execution groups. Tasks within a group run concurrently. Groups run sequentially.

**TaskNode tree**:
```typescript
interface TaskNode {
  id: string;              // "dev-1", "review-1"
  parentId: string | null; // "root" for leaves, null for root
  description: string;
  role?: string;           // "Developer" | "Code Reviewer"
  kind: TaskKind;          // "atomic" | "composite"
  status: TaskStatus;      // "pending" | "running" | "done" | "failed"
  depth: number;
  lineage: string[];       // ancestor descriptions [root → parent]
  children: TaskNode[];
  assignedTo?: string;     // agentId
  result?: string;
}
```

**Scheduler flow**:
```
scheduler.start()
    → dispatch group[0] tasks concurrently
    → each task gets lineage + siblings context injected into prompt
    → wait for all group[0] tasks to complete (done or failed)
    → dispatch group[1]
    → ...
    → all groups done → finalize plan (propagate status up tree)
```

**Context injection** (into worker prompts via `{{taskContext}}` variable):
```
## Task Hierarchy
0. Build a pixel snake game
  1. Implement PixiJS snake movement  <-- (this task)

## Parallel Work
Sibling tasks being worked on in parallel:
  - Add collision detection and scoring

Do not duplicate sibling work. If you need interfaces from siblings, define stubs.
```

**Status**: Parser + Scheduler are tested and working. NOT YET wired into orchestrator execution flow (see "What's Next").

---

### 4. Agent Plugin (`packages/orchestrator/src/agent/`, `apps/gateway/src/agents/`)

**Purpose**: Pluggable AI backend adapter with activity detection and workspace hooks.

**Interface** (`packages/orchestrator/src/agent/types.ts`):
```typescript
interface AgentPlugin {
  readonly id: string;          // "claude", "codex", "gemini"
  readonly name: string;        // "Claude Code", "Codex CLI"
  readonly command: string;     // CLI command (resolved to absolute path)
  readonly stability: BackendStability;  // "stable" | "beta" | "experimental"
  readonly guardType: GuardType;         // "hooks" | "sandbox" | "flag" | "none"
  readonly instructionPath?: string;     // ".claude/CLAUDE.md", "AGENTS.md", etc.

  buildArgs(prompt, opts): string[];
  getCleanEnv?(): string[];

  // New capabilities (stubs, not yet implemented)
  detectActivity?(session: AgentSessionRef): ActivityState | null;
  getSessionInfo?(session: AgentSessionRef): AgentSessionInfo | null;
  setupWorkspaceHooks?(workspacePath, config): void;
  getRestoreCommand?(session: AgentSessionRef): string[] | null;

  readonly capabilities: {
    stdin: boolean;
    resume: boolean;
    agentType: boolean;
    nativeWorktree: boolean;
    structuredOutput: boolean;
  };
}
```

**Backend files** (`apps/gateway/src/agents/`):
```
agents/
  common.ts           — isRoot, ensureClaudeSettingsForRoot(), VERSION_PROBES, probeAndResolve()
  claude-code.ts      — createClaudeCodeAgent()   [stable, hooks, stdin+resume+agentType+worktree+json]
  codex.ts            — createCodexAgent()         [stable, sandbox]
  gemini.ts           — createGeminiAgent()        [beta, flag]
  copilot.ts          — createCopilotAgent()       [experimental]
  cursor.ts           — createCursorAgent()        [experimental, binary="agent"]
  aider.ts            — createAiderAgent()         [experimental]
  opencode.ts         — createOpenCodeAgent()      [experimental, json output]
  pi.ts               — createPiAgent()            [experimental]
  sapling.ts          — createSaplingAgent()       [experimental, json output]
  index.ts            — getAllAgents(), detectAndCreateAgents()
```

**Gateway integration**: `apps/gateway/src/index.ts` imports from `./agents/index.js` instead of old `backends.ts`.

**Note**: `AIBackend` type is still used internally by `agent-session.ts` and `orchestrator.ts`. `AgentPlugin` is a superset — all old fields are preserved with `@deprecated` annotations. Full internal migration to `AgentPlugin` is deferred.

---

### 5. Notifier + PluginRegistry

**Notifier** (`packages/orchestrator/src/notifier/`):

```typescript
interface Notifier {
  readonly name: string;
  send(notification: OrchestratorNotification): Promise<void>;
}

interface OrchestratorNotification {
  title: string;
  message: string;
  priority: "urgent" | "action" | "warning" | "info";
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}
```

Built-in: `createWebSocketNotifier(emitEvent)` — emits as orchestrator event, gateway forwards to WebSocket/Ably clients.

**Note**: Type is named `OrchestratorNotification` (not `Notification`) to avoid DOM type collision. Deprecated alias `Notification` is re-exported for backward compat.

**PluginRegistry** (`packages/orchestrator/src/plugin-registry.ts`):

```typescript
type PluginSlot = "agent" | "workspace" | "notifier";

interface PluginRegistry {
  register<T>(slot, name, instance): void;
  get<T>(slot, name): T | null;
  getDefault<T>(slot): T | null;
  list(slot): PluginManifest[];
}
```

Lightweight Map-based registry. No dynamic discovery — just register + get.

| Slot | Default | Alternatives |
|------|---------|-------------|
| agent | claude-code | codex, gemini, copilot, cursor, aider, opencode, pi, sapling |
| workspace | worktree | (future: clone) |
| notifier | websocket | (future: desktop, telegram) |

**Note**: Registry is exported and usable, but the orchestrator constructor does NOT yet accept a registry. It still takes `backends: AIBackend[]`. Registry-based construction is deferred.

---

## Directory Structure (New Files)

```
packages/orchestrator/src/
  reaction/                          ← Phase 1: WIRED into orchestrator
    types.ts                         facades, rules, context
    engine.ts                        ReactionEngine class
    defaults.ts                      DEFAULT_RULES
    __tests__/engine.test.ts         13 tests
    index.ts

  workspace/                         ← Phase 2: WIRED into orchestrator
    types.ts                         Workspace interface
    worktree.ts                      WorktreeWorkspace adapter
    post-create.ts                   symlinks + commands
    __tests__/post-create.test.ts    8 tests
    index.ts

  decomposer/                        ← Phase 3: standalone (NOT YET wired)
    types.ts                         TaskNode, DecompositionPlan
    parser.ts                        [DECOMPOSITION] block parser
    scheduler.ts                     group-based dispatch
    context.ts                       formatLineage(), formatSiblings()
    __tests__/parser.test.ts         9 tests
    __tests__/context.test.ts        6 tests
    __tests__/scheduler.test.ts      7 tests
    index.ts

  agent/                             ← Phase 4: types defined, backends migrated
    types.ts                         AgentPlugin interface
    index.ts

  notifier/                          ← Phase 5: types defined, websocket impl
    types.ts                         OrchestratorNotification, Notifier
    websocket.ts                     createWebSocketNotifier()
    index.ts

  plugin-registry.ts                 ← Phase 5: standalone (NOT YET wired to constructor)
  __tests__/plugin-registry.test.ts  7 tests

apps/gateway/src/
  agents/                            ← Phase 4: replaces backends.ts
    common.ts
    claude-code.ts ... sapling.ts    (9 backends)
    index.ts
```

## Deleted Files

| File | Replacement |
|------|-------------|
| `packages/orchestrator/src/retry.ts` | `reaction/engine.ts` |
| `apps/gateway/src/backends.ts` | `apps/gateway/src/agents/` |

## Modified Files (Key Changes)

| File | What Changed |
|------|-------------|
| `orchestrator.ts` | RetryTracker → ReactionEngine; direct worktree calls → workspaceAdapter; facade builders added |
| `delegation.ts` | Emits `review:fail` event on VERDICT:FAIL; devFixAttempts kept with TODO |
| `types.ts` | Added ReviewFailEvent, NotificationEvent, reactions option, postCreate option |
| `config.ts` | `maxReviewRounds`, `maxDirectFixes`, `hardCeilingRounds` deprecated; `retryDelayMs` removed |
| `output-parser.ts` | Re-exports decomposition parser |
| `prompt-templates.ts` | Added `{{taskContext}}` variable to worker-initial and worker-direct-fix |
| `index.ts` | Exports all new modules |
| `agent-session.ts` | Added `lastPrompt` getter |
| `apps/gateway/src/index.ts` | Imports from `./agents/` instead of `./backends.js` |

---

## What's Wired vs What's Not

| Component | Wired into Orchestrator? | Notes |
|-----------|------------------------|-------|
| ReactionEngine | YES | Replaces RetryTracker in _handleSessionEventUnsafe |
| WorktreeWorkspace | YES | Replaces direct worktree function calls |
| Decomposer Parser | NO | Standalone module, not called during execution |
| Decomposer Scheduler | NO | Standalone module, not connected to dispatch |
| Context Injection | PARTIAL | `{{taskContext}}` placeholder added to prompts, not populated |
| AgentPlugin interface | PARTIAL | Types defined, backends migrated, but orchestrator still uses AIBackend internally |
| Notifier | NO | WebSocket impl exists, not connected to reaction engine's "notify" action |
| PluginRegistry | NO | Exported but orchestrator constructor doesn't use it |

---

## What's Next: Execution Wiring

To enable the new auto-decompose + auto-assign mode, 4 tasks remain:

### Task A: Update Leader Prompt
Modify `leader-initial` template to instruct Leader to output `[DECOMPOSITION]` blocks when delegating in execute phase.

### Task B: Wire Scheduler into Execute Phase
In `orchestrator.ts`, when Leader output contains a `[DECOMPOSITION]` block:
1. Parse it with `tryParseDecomposition()`
2. Create a `TaskScheduler` with the plan
3. For each dispatched task, call `DelegationRouter.delegate()` with lineage/siblings context
4. On task completion/failure, call `scheduler.taskCompleted()`/`scheduler.taskFailed()`
5. Fallback: if no `[DECOMPOSITION]` block, use old DelegationRouter flow (backward compat)

### Task C: Agent Selection Logic
Add role-based agent matching:
- Scheduler dispatches task with `role: "Developer"`
- Orchestrator finds available agent with matching role
- If no match, fall back to any idle agent
- If no idle agent, queue the task

### Task D: Connect Notifier to Reaction Engine
Wire the `"notify"` action in ReactionEngine to actually call the registered Notifier's `send()` method (currently it calls `emitNotification` on the facade, which emits a raw event — should also go through Notifier plugin).

### Future: Registry-Based Construction
Replace `OrchestratorOptions.backends: AIBackend[]` with `OrchestratorOptions.registry: PluginRegistry`. This is a breaking API change that requires updating all consumers (gateway, tests).

### Future: Full DelegationRouter Migration
Move `devFixAttempts` tracking from DelegationRouter to ReactionEngine (marked with TODO). Remove the deprecated config constants.
