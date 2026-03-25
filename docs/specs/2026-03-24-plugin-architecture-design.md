# Plugin Architecture Refactor — Design Spec

**Date**: 2026-03-24
**Branch**: `refactor/plugin-architecture`
**Approach**: Feature-First (incremental, each step delivers independent value)
**Inspiration**: [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)

## Overview

Refactor `@bit-office/orchestrator` from a monolithic engine into a modular, plugin-driven architecture. Five workstreams, ordered by dependency and user value:

1. **Reaction Engine** — configurable event-driven automation
2. **Workspace Abstraction** — pluggable isolation + postCreate hooks
3. **Hybrid Task Decomposer** — structured task breakdown with lineage context
4. **Agent Plugin** — pluggable AI backend with activity detection
5. **Notifier + PluginRegistry** — unified plugin system + notification channels

Breaking changes are allowed. All existing functionality must be preserved.

---

## 1. Reaction Engine

### Problem

Retry, escalation, review-fail routing, and timeout logic are hardcoded across `retry.ts`, `delegation.ts`, and `orchestrator.ts`. Adding a new reaction (e.g. "notify user when agent is stuck for 5 minutes") requires modifying multiple files.

### Design

#### Types

```typescript
// packages/orchestrator/src/reaction/types.ts

type ReactionTrigger =
  | "task:failed"
  | "review:fail"
  | "agent:stuck"
  | "agent:error"
  | "delegation:budget"
  | "task:done";

type ReactionAction =
  | "retry"
  | "send-to-agent"
  | "escalate-to-leader"
  | "notify"
  | "force-finalize";

/** Rich context passed to the engine alongside every event */
interface ReactionContext {
  agentId: string;
  taskId: string;
  role?: string;                  // "Developer" | "Code Reviewer" | "Team Lead"
  wasTimeout?: boolean;           // session.wasTimeout
  wasCancellation?: boolean;      // task was cancelled, not failed
  isDelegated?: boolean;          // delegationRouter.isDelegated(taskId)
  reviewerOutput?: string;        // full reviewer output (for VERDICT parsing)
  attempt?: number;               // current retry/fix attempt count
  session: AgentSessionFacade;    // restricted access to session operations
  orchestrator: OrchestratorFacade; // restricted access to orchestrator operations
}

/** Minimal session operations the engine can invoke */
interface AgentSessionFacade {
  prependTask(taskId: string, prompt: string): void;
  getAgentId(): string;
  getRole(): string;
}

/** Minimal orchestrator operations the engine can invoke */
interface OrchestratorFacade {
  getTeamLead(): AgentSessionFacade | null;
  runTask(agentId: string, taskId: string, prompt: string): void;
  forceFinalize(agentId: string): void;
  emitNotification(notification: Notification): void;
}

interface ReactionRule {
  trigger: ReactionTrigger;
  match?: {
    role?: string;
    attempt?: { gte?: number };
    wasTimeout?: boolean;
    isDelegated?: boolean;
  };
  action: ReactionAction;
  retries?: number;
  escalateAction?: ReactionAction;
  thresholdMs?: number;
}

interface ReactionEngineConfig {
  rules: ReactionRule[];
}
```

#### Event Emission: Who emits `review:fail`?

`review:fail` is NOT an existing orchestrator event. The `DelegationRouter` currently detects VERDICT:FAIL by parsing reviewer output with a regex. After the refactor:

1. `DelegationRouter` remains responsible for detecting `VERDICT: FAIL` in reviewer output (it already does this)
2. On detection, it emits a new `review:fail` event via the orchestrator's EventEmitter
3. The Reaction Engine subscribes to this event and decides the action (direct fix, escalate, etc.)

This keeps VERDICT parsing where it already lives (delegation) and avoids duplicating regex logic in the engine.

New event type added to `types.ts`:

```typescript
interface ReviewFailEvent {
  type: "review:fail";
  agentId: string;         // reviewer agentId
  taskId: string;
  reviewerOutput: string;  // full output for context
  devAgentId?: string;     // which dev the review was for
}
```

#### Default Rules (preserving current behavior)

```typescript
// packages/orchestrator/src/reaction/defaults.ts

const DEFAULT_RULES: ReactionRule[] = [
  // retry.ts behavior: retry failed tasks, skip timeouts and cancellations
  { trigger: "task:failed",
    match: { wasTimeout: false },
    action: "retry", retries: 2,
    escalateAction: "escalate-to-leader" },

  // delegation.ts VERDICT:FAIL -> direct fix behavior
  { trigger: "review:fail",
    action: "send-to-agent", retries: 1,
    escalateAction: "escalate-to-leader" },

  // hardCeilingRounds behavior
  { trigger: "delegation:budget", action: "force-finalize" },

  // New: stuck detection
  { trigger: "agent:stuck", thresholdMs: 300_000, action: "notify" },
];
```

#### Architecture

`ReactionEngine` receives events + `ReactionContext`, matches rules, executes actions through facades. Orchestrator constructs the context and delegates; it no longer handles retry/escalation directly.

```
Orchestrator receives event (task:failed, etc.)
    |
    v
Construct ReactionContext (session facade, orchestrator facade, metadata)
    |
    v
ReactionEngine.handle(event, context)
    |
    v
Match rules by trigger + match conditions
    |
    v
Execute action via facade (retry / send-to-agent / escalate / notify / force-finalize)
    |
    +-- retries exhausted? --> execute escalateAction
```

#### Memory Recording

Memory recording (`recordReviewFeedback`, `recordProjectCompletion`, `recordTechPreference`) stays in the orchestrator's own event listeners. The Reaction Engine handles **operational responses** (retry, escalate, notify). Memory is a **side-effect concern**, not a reaction — it always runs regardless of which reaction fires.

#### Files

```
packages/orchestrator/src/reaction/
  types.ts          — interfaces above (including facades)
  engine.ts         — ReactionEngine class
  defaults.ts       — DEFAULT_RULES
  index.ts          — exports
```

#### Deleted/Refactored

- `retry.ts` — removed entirely, logic migrated to reaction engine `retry` action
- `delegation.ts` — `devFixAttempts`/`reviewCount`/`maxDirectFixes` logic migrated to `review:fail` rule; VERDICT detection stays, now emits `review:fail` event
- `config.ts` — `hardCeilingRounds`/`maxReviewRounds` become reaction rule parameters

---

## 2. Workspace Abstraction

### Problem

`worktree.ts` (932 lines) is a flat collection of exported functions. No abstraction boundary — orchestrator directly calls git commands. No postCreate hooks — worktrees lack `.env`, dependencies, agent-specific config.

### Design

#### Interface

```typescript
// packages/orchestrator/src/workspace/types.ts

interface WorkspaceInfo {
  path: string;
  branch: string;
  agentId: string;
}

/** Input config for creating a workspace — subset of full owner info */
interface WorkspaceCreateConfig {
  repoRoot: string;
  agentId: string;
  agentName: string;
  /** Partial owner info (agentId/branch/repoRoot are derived during creation) */
  owner?: Omit<WorktreeOwnerInfo, "agentId" | "agentName" | "branch" | "repoRoot">;
}

interface WorkspaceMergeResult {
  success: boolean;
  commitHash?: string;
  commitMessage?: string;
  conflictFiles?: string[];
  stagedFiles?: string[];
}

interface RevertResult {
  success: boolean;
  commitId?: string;
  message?: string;
  commitsAhead: number;
}

/**
 * All methods that operate on an existing workspace take two paths:
 * - repoRoot: the main repository root (where main branch lives)
 * - worktreePath: the agent's workspace directory
 * This matches the existing function signatures in worktree.ts.
 */
interface Workspace {
  readonly name: string;

  create(config: WorkspaceCreateConfig): WorkspaceInfo | null;
  destroy(repoRoot: string, worktreePath: string, branch: string): void;
  sync(repoRoot: string, worktreePath: string): void;
  merge(repoRoot: string, worktreePath: string, branch: string,
        opts?: { keepAlive?: boolean; summary?: string; agentName?: string }
  ): WorkspaceMergeResult;
  revert(repoRoot: string, worktreePath: string): RevertResult;
  undoMerge(repoRoot: string, commitHash: string): { success: boolean; message?: string };
  hasPendingChanges(repoRoot: string, worktreePath: string): boolean;
  checkConflicts(repoRoot: string, branch: string): string[];
  cleanup(repoRoot: string, activeBranches: Set<string>,
          options?: CleanupWorktreeOptions
  ): { removedBranches: string[]; removedWorktrees: string[] };

  postCreate?(info: WorkspaceInfo, config: PostCreateConfig): Promise<void>;
}

interface PostCreateConfig {
  /** Relative paths to symlink from main repo into workspace */
  symlinks?: string[];
  /** Shell commands to run after creation */
  commands?: string[];
}
```

#### Implementation

Current `worktree.ts` functions become methods on `WorktreeWorkspace implements Workspace`. Logic unchanged, only reorganized. The class constructor receives the centralized worktree base dir path.

#### postCreate

```typescript
// Usage in orchestrator options
const orc = createOrchestrator({
  workspace: {
    plugin: "worktree",
    mergeOnComplete: true,
    alwaysIsolate: true,
    postCreate: {
      symlinks: [".env", ".claude"],
      commands: ["pnpm install --frozen-lockfile"],
    },
  },
});
```

After worktree creation:
1. Symlink `.env` and `.claude` from main repo (with path traversal validation)
2. Run `pnpm install`

#### PostCreate Error Handling

If a postCreate command fails:
- Log a warning with the command and error
- Continue with workspace creation (do not fail the whole operation)
- The agent will encounter missing dependencies and fail on its own
- Reaction Engine's `task:failed` rule handles the retry/escalation

This is intentional — failing the workspace creation would leave an orphaned worktree. Letting the agent fail gives the reaction engine a chance to handle it.

#### Security

- Symlink paths must be relative, no `..` segments
- Resolved path verified to stay within workspace boundary
- postCreate commands from trusted config only (orchestrator options), never from agent output

#### Files

```
packages/orchestrator/src/workspace/
  types.ts
  worktree.ts         — WorktreeWorkspace implements Workspace
  post-create.ts      — symlink + command execution
  index.ts
```

Deleted: `packages/orchestrator/src/worktree.ts` (migrated)

---

## 3. Hybrid Task Decomposer

### Problem

Task delegation is unstructured — Leader freely decides what to delegate and to whom. No tracking of task hierarchy, no parallel execution awareness, no sibling context injection. Workers may duplicate each other's work.

### Design

#### Types

```typescript
// packages/orchestrator/src/decomposer/types.ts

type TaskKind = "atomic" | "composite";
type TaskStatus = "pending" | "running" | "done" | "failed";

interface TaskNode {
  id: string;              // hierarchical: "1", "1.2", "1.2.3"
  parentId: string | null; // explicit parent reference (avoids string parsing)
  description: string;
  role?: string;           // "Developer" | "Code Reviewer"
  kind: TaskKind;
  status: TaskStatus;
  depth: number;
  lineage: string[];       // ancestor descriptions (root -> parent)
  children: TaskNode[];
  assignedTo?: string;     // agentId
  result?: string;
}

interface DecompositionPlan {
  id: string;
  rootTask: string;
  tree: TaskNode;
  phase: "planning" | "review" | "approved" | "executing" | "done";
}
```

#### Two Decomposition Paths

**Path A — Leader-driven (default):**

Leader prompt requires structured `[DECOMPOSITION]` output:

```
[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Implement PixiJS snake movement" },
    { "id": "dev-2", "role": "Developer", "description": "Add collision detection and scoring" },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review game implementation" }
  ],
  "groups": [["dev-1", "dev-2"], ["review-1"]]
}
[/DECOMPOSITION]
```

Task IDs are explicit strings (not indices) — robust against reordering. `groups` replaces `parallel` for clarity — each group runs sequentially, tasks within a group run concurrently.

Orchestrator's `output-parser.ts` parses this block into a TaskNode tree.

**Path B — LLM-driven (opt-in for complex tasks):**

Independent API call to classify (atomic/composite) and recursively decompose. Enabled via config:

```typescript
interface DecomposerConfig {
  enabled: boolean;          // default false
  maxDepth: number;          // default 3
  model: string;             // default claude-sonnet-4-20250514
  requireApproval: boolean;  // default true
}
```

#### Lineage/Siblings Context Injection

When a worker receives a delegated task, its prompt includes:

```
## Task Hierarchy
0. Build a pixel snake game
  1. Implement PixiJS snake movement  <-- (this task)

## Parallel Work
Sibling tasks being worked on in parallel:
  - Add collision detection and scoring

Do not duplicate sibling work. If you need interfaces from siblings, define stubs.
```

#### Scheduler

`scheduler.ts` reads the TaskNode tree and `groups`:
- Dispatch all tasks in a group concurrently
- Wait for group completion before starting the next group
- Propagate done/failed status up the tree
- On task failure: delegate to Reaction Engine (which decides retry/escalate)

#### Responsibility Matrix: Scheduler vs DelegationRouter

| Responsibility | Owner After Refactor |
|---|---|
| Parse [DECOMPOSITION] block | `decomposer/parser.ts` |
| Build TaskNode tree | `decomposer/parser.ts` |
| Decide dispatch order (groups) | `decomposer/scheduler.ts` |
| Track task tree status | `decomposer/scheduler.ts` |
| Inject lineage/siblings context | `decomposer/context.ts` |
| **Create agent task + spawn process** | `DelegationRouter` (unchanged) |
| **Forward results between agents** | `DelegationRouter` (unchanged) |
| **Batch result forwarding + timers** | `DelegationRouter` (unchanged) |
| Track `totalDelegations` | `DelegationRouter` (unchanged) |
| Track `leaderRounds` | `DelegationRouter` (unchanged) |
| Detect VERDICT:FAIL, emit `review:fail` | `DelegationRouter` (unchanged) |
| Handle failure/retry/escalation | `ReactionEngine` |

The scheduler calls `DelegationRouter.delegate()` for each task dispatch. The router's internal bookkeeping (`totalDelegations`, `leaderRounds`, `assignedTask` map) stays intact. The scheduler adds the layer of structured ordering and context injection on top.

#### Files

```
packages/orchestrator/src/decomposer/
  types.ts              — TaskNode, DecompositionPlan
  parser.ts             — parse [DECOMPOSITION] block from Leader output
  llm-decomposer.ts     — independent LLM classify + decompose (optional)
  scheduler.ts          — group-based task dispatch + status propagation
  context.ts            — formatLineage(), formatSiblings()
  index.ts
```

---

## 4. Agent Plugin Abstraction

### Problem

`AIBackend` interface is minimal — just `buildArgs()` and capability flags. No activity detection (can't tell if agent is stuck), no workspace hooks (can't auto-update metadata on git commands), no session info extraction. Backend definitions live in gateway (`backends.ts`), not as independent plugins.

### Design

#### Interface

```typescript
// packages/orchestrator/src/agent/types.ts

interface AgentPlugin {
  readonly name: string;
  readonly command: string;
  readonly stability: BackendStability;
  readonly guardType: GuardType;

  buildArgs(prompt: string, opts: BuildArgsOpts): string[];
  getCleanEnv?(): string[];

  // New capabilities (inspired by AO)
  detectActivity?(session: AgentSessionRef): ActivityState;
  getSessionInfo?(session: AgentSessionRef): AgentSessionInfo | null;
  setupWorkspaceHooks?(workspacePath: string, config: WorkspaceHooksConfig): void;
  getRestoreCommand?(session: AgentSessionRef): string[] | null;

  readonly capabilities: {
    stdin: boolean;
    resume: boolean;
    agentType: boolean;
    nativeWorktree: boolean;
    structuredOutput: boolean;
  };

  readonly instructionPath?: string;
}

type ActivityState =
  | "active"
  | "ready"
  | "idle"
  | "waiting_input"
  | "exited";

/** Session reference for plugin queries. AgentSession exposes pid via getter. */
interface AgentSessionRef {
  agentId: string;
  workspacePath: string | null;
  pid: number | undefined;         // from AgentSession.pid getter (already exists)
  lastOutputAt: number | undefined; // timestamp of last stdout activity
}

interface AgentSessionInfo {
  summary: string | null;
  agentSessionId: string | null;
  cost?: { inputTokens: number; outputTokens: number };
}

interface WorkspaceHooksConfig {
  dataDir: string;
  sessionId?: string;
}
```

#### Migration

Each object in `backends.ts` becomes a separate file implementing `AgentPlugin`:

```
apps/gateway/src/agents/
  claude-code.ts       — includes setupWorkspaceHooks (PostToolUse metadata updater)
  codex.ts
  gemini.ts
  copilot.ts
  cursor.ts
  aider.ts
  opencode.ts
  pi.ts
  sapling.ts
  index.ts             — detectAndRegister() auto-probes installed CLIs
```

#### Activity Detection

- Claude Code: parse `~/.claude/projects/` JSONL logs for last activity timestamp
- Generic fallback: compare `lastOutputAt` against threshold in `agent-session.ts`

Provides reliable data source for Reaction Engine's `agent:stuck` trigger.

#### setupWorkspaceHooks

Claude Code implementation writes `.claude/settings.json` with a PostToolUse hook that auto-updates session metadata when agent runs `git push`, `gh pr create`, etc.

#### Deleted

- `packages/orchestrator/src/ai-backend.ts` — replaced by `agent/types.ts`
- `apps/gateway/src/backends.ts` — replaced by `apps/gateway/src/agents/`

---

## 5. Notifier Slot + PluginRegistry

### Problem

Reaction Engine's `notify` action has no output channel. Plugin slots (agent, workspace, notifier) exist independently with no unified registry.

### Design

#### Notifier Interface

```typescript
// packages/orchestrator/src/notifier/types.ts

type NotificationPriority = "urgent" | "action" | "warning" | "info";

interface Notification {
  title: string;
  message: string;
  priority: NotificationPriority;
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

interface Notifier {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}
```

#### Built-in Notifiers

| Name | Mechanism | Config |
|------|-----------|--------|
| `websocket` | Emit `notification` event, gateway forwards to web UI | Zero config (default) |
| `desktop` | macOS native notification | Optional |
| `telegram` | Reuse existing Telegram channel | Requires bot token |

#### Notification Event Type

New event added to `OrchestratorEventMap`:

```typescript
interface NotificationEvent {
  type: "notification";
  notification: Notification;
}
```

The websocket notifier calls `orchestrator.emit("notification", { type: "notification", notification })`. Gateway subscribes to this event and forwards to WebSocket/Ably clients, same as all other events. Web UI displays notifications in an attention zone or toast.

#### PluginRegistry

```typescript
// packages/orchestrator/src/plugin-registry.ts

type PluginSlot = "agent" | "workspace" | "notifier";

interface PluginManifest {
  name: string;
  slot: PluginSlot;
}

interface PluginRegistry {
  register<T>(slot: PluginSlot, name: string, instance: T): void;
  get<T>(slot: PluginSlot, name: string): T | null;
  getDefault<T>(slot: PluginSlot): T | null;
  list(slot: PluginSlot): PluginManifest[];
}
```

Lightweight — no npm dynamic discovery, just register + get. Three slots:

| Slot | Default | Alternatives |
|------|---------|-------------|
| agent | claude-code | codex, gemini, copilot, cursor, aider, opencode, pi, sapling |
| workspace | worktree | (future: clone) |
| notifier | websocket | desktop, telegram |

#### New Orchestrator Construction

```typescript
const registry = createPluginRegistry();

registry.register("agent", "claude-code", createClaudeCodeAgent());
registry.register("agent", "codex", createCodexAgent());
registry.register("workspace", "worktree", createWorktreeWorkspace({ ... }));
registry.register("notifier", "websocket", createWebSocketNotifier(emitEvent));

const orc = createOrchestrator({
  registry,
  workspace: "worktree",
  reactions: DEFAULT_RULES,
  decomposer: { enabled: false },
});
```

#### Files

```
packages/orchestrator/src/notifier/
  types.ts
  websocket.ts
  desktop.ts
  telegram.ts
  index.ts

packages/orchestrator/src/plugin-registry.ts
```

---

## Final Directory Structure

```
packages/orchestrator/src/
  agent/
    types.ts                — AgentPlugin interface
    index.ts
  workspace/
    types.ts                — Workspace interface
    worktree.ts             — WorktreeWorkspace implements Workspace
    post-create.ts          — symlink + command execution
    index.ts
  reaction/
    types.ts                — ReactionRule, ReactionTrigger, ReactionAction, facades
    engine.ts               — ReactionEngine class
    defaults.ts             — DEFAULT_RULES
    index.ts
  decomposer/
    types.ts                — TaskNode, DecompositionPlan
    parser.ts               — parse [DECOMPOSITION] from Leader output
    llm-decomposer.ts       — optional LLM classify + decompose
    scheduler.ts            — group-based task dispatch + status propagation
    context.ts              — formatLineage(), formatSiblings()
    index.ts
  notifier/
    types.ts                — Notifier, Notification
    websocket.ts
    desktop.ts
    telegram.ts
    index.ts
  plugin-registry.ts        — PluginRegistry
  orchestrator.ts           — core engine (slimmed, delegates to modules)
  agent-session.ts          — process management (uses AgentPlugin)
  agent-manager.ts          — session registry
  delegation.ts             — execution layer + VERDICT detection + result batching
  phase-machine.ts          — unchanged
  output-parser.ts          — extended: parse [DECOMPOSITION] block
  prompt-templates.ts       — extended: lineage/siblings injection
  result-finalizer.ts       — unchanged
  preview-resolver.ts       — unchanged
  preview-server.ts         — unchanged
  resolve-path.ts           — unchanged
  memory.ts                 — KEPT as re-export shim (imports from @bit-office/memory)
  config.ts                 — slimmed (constants moved to module defaults)
  types.ts                  — extended: ReviewFailEvent, NotificationEvent
  index.ts                  — public exports
```

### Deleted Files

| File | Replacement |
|------|-------------|
| `ai-backend.ts` | `agent/types.ts` |
| `worktree.ts` | `workspace/worktree.ts` |
| `retry.ts` | `reaction/engine.ts` |

Note: `memory.ts` is a re-export shim for `@bit-office/memory`. It is **kept** to avoid breaking imports in `orchestrator.ts` and `agent-session.ts`.

### Gateway Changes

```
apps/gateway/src/
  backends.ts              — deleted
  agents/                  — new: per-backend AgentPlugin files
    claude-code.ts
    codex.ts
    gemini.ts
    ...
    index.ts               — detectAndRegister()
  index.ts                 — updated: use PluginRegistry, new createOrchestrator API
```

---

## Implementation Order

| Phase | What | Depends On | Estimated Scope |
|-------|------|-----------|-----------------|
| 1 | Reaction Engine | — | reaction/, refactor retry.ts + delegation.ts |
| 2 | Workspace Abstraction | — | workspace/, refactor worktree.ts |
| 3 | Task Decomposer | Phase 1 + 2 | decomposer/, refactor delegation.ts + prompt-templates.ts |
| 4 | Agent Plugin | Phase 1 + 2 | agent/, refactor backends.ts + agent-session.ts |
| 5 | Notifier + Registry | Phase 1 + 4 | notifier/, plugin-registry.ts, new orchestrator API |

Phases 1 and 2 are independent and can be done in parallel.
Phase 3 depends on Phase 1 (reaction engine handles decomposer task failures) and Phase 2 (scheduler dispatches to agents in workspaces).
Phase 4 depends on Phase 1 (activity detection feeds agent:stuck trigger) and Phase 2 (agent plugins call workspace hooks via Workspace interface).
Phase 5 ties everything together.
