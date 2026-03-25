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

interface ReactionRule {
  trigger: ReactionTrigger;
  match?: { role?: string; attempt?: { gte?: number } };
  action: ReactionAction;
  retries?: number;
  escalateAction?: ReactionAction;
  thresholdMs?: number;
}

interface ReactionEngineConfig {
  rules: ReactionRule[];
}
```

#### Default Rules (preserving current behavior)

```typescript
// packages/orchestrator/src/reaction/defaults.ts

const DEFAULT_RULES: ReactionRule[] = [
  // retry.ts behavior
  { trigger: "task:failed", action: "retry", retries: 2,
    escalateAction: "escalate-to-leader" },

  // delegation.ts VERDICT:FAIL -> direct fix behavior
  { trigger: "review:fail", match: { attempt: { gte: 0 } },
    action: "send-to-agent", retries: 1,
    escalateAction: "escalate-to-leader" },

  // hardCeilingRounds behavior
  { trigger: "delegation:budget", action: "force-finalize" },

  // New: stuck detection
  { trigger: "agent:stuck", thresholdMs: 300_000, action: "notify" },
];
```

#### Architecture

`ReactionEngine` subscribes to Orchestrator events, matches rules, executes actions. Orchestrator emits events; it no longer handles retry/escalation directly.

```
Orchestrator emits event
    |
    v
ReactionEngine.onEvent(event)
    |
    v
Match rules by trigger + match conditions
    |
    v
Execute action (retry / send-to-agent / escalate / notify / force-finalize)
    |
    +-- retries exhausted? --> execute escalateAction
```

#### Files

```
packages/orchestrator/src/reaction/
  types.ts          — interfaces above
  engine.ts         — ReactionEngine class
  defaults.ts       — DEFAULT_RULES
  index.ts          — exports
```

#### Deleted/Refactored

- `retry.ts` — removed entirely, logic migrated to reaction engine `retry` action
- `delegation.ts` — `devFixAttempts`/`reviewCount`/`maxDirectFixes` logic migrated to `review:fail` rule
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

interface WorkspaceCreateConfig {
  repoRoot: string;
  agentId: string;
  agentName: string;
  owner?: WorktreeOwnerInfo;
}

interface WorkspaceMergeResult {
  success: boolean;
  commitHash?: string;
  commitMessage?: string;
  conflictFiles?: string[];
  stagedFiles?: string[];
}

interface Workspace {
  readonly name: string;

  create(config: WorkspaceCreateConfig): WorkspaceInfo | null;
  destroy(agentId: string, branch: string): void;
  sync(workspace: string, worktreePath: string): void;
  merge(workspace: string, worktreePath: string, branch: string,
        opts?: { keepAlive?: boolean; summary?: string; agentName?: string }
  ): WorkspaceMergeResult;
  revert(workspace: string, worktreePath: string): RevertResult;
  undoMerge(workspace: string, commitHash: string): { success: boolean; message?: string };
  hasPendingChanges(workspace: string, worktreePath: string): boolean;
  checkConflicts(workspace: string, branch: string): string[];
  cleanup(workspace: string, activeBranches: Set<string>,
          options?: CleanupWorktreeOptions
  ): { removedBranches: string[]; removedWorktrees: string[] };

  postCreate?(info: WorkspaceInfo, hooks: PostCreateConfig): Promise<void>;
}

interface PostCreateConfig {
  symlinks?: string[];      // relative paths to symlink from main repo
  commands?: string[];      // shell commands to run after creation
}
```

#### Implementation

Current `worktree.ts` functions become methods on `WorktreeWorkspace implements Workspace`. Logic unchanged, only reorganized.

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

#### Security

- Symlink paths must be relative, no `..` segments
- Resolved path verified to stay within workspace
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
  description: string;
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
    { "role": "Developer", "description": "Implement PixiJS snake movement" },
    { "role": "Developer", "description": "Add collision detection and scoring" },
    { "role": "Code Reviewer", "description": "Review game implementation" }
  ],
  "parallel": [[0, 1], [2]]
}
[/DECOMPOSITION]
```

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

`scheduler.ts` reads the TaskNode tree and `parallel` groups:
- Dispatch all tasks in a parallel group concurrently
- Wait for group completion before starting the next group
- Propagate done/failed status up the tree

#### Relationship with delegation.ts

`DelegationRouter` becomes an **execution layer** only — it creates tasks and forwards results. Scheduling logic moves up to the decomposer scheduler.

#### Files

```
packages/orchestrator/src/decomposer/
  types.ts              — TaskNode, DecompositionPlan
  parser.ts             — parse [DECOMPOSITION] block from Leader output
  llm-decomposer.ts     — independent LLM classify + decompose (optional)
  scheduler.ts          — dispatch tasks by tree + parallel groups
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

interface AgentSessionRef {
  agentId: string;
  workspacePath: string | null;
  runtimeHandle: { pid?: number };
}

interface AgentSessionInfo {
  summary: string | null;
  agentSessionId: string | null;
  cost?: { inputTokens: number; outputTokens: number };
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
- Generic fallback: track last stdout activity time in agent-session.ts

Provides reliable data source for Reaction Engine's `agent:stuck` trigger.

#### setupWorkspaceHooks

Claude Code implementation writes `.claude/settings.json` with a PostToolUse hook that auto-updates session metadata when agent runs `git push`, `gh pr create`, etc.

#### Deleted

- `packages/orchestrator/src/ai-backend.ts` — replaced by `agent/types.ts`

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
    types.ts                — ReactionRule, ReactionTrigger, ReactionAction
    engine.ts               — ReactionEngine class
    defaults.ts             — DEFAULT_RULES
    index.ts
  decomposer/
    types.ts                — TaskNode, DecompositionPlan
    parser.ts               — parse [DECOMPOSITION] from Leader output
    llm-decomposer.ts       — optional LLM classify + decompose
    scheduler.ts            — tree-based task dispatch
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
  delegation.ts             — execution layer only (scheduling moved to decomposer)
  phase-machine.ts          — unchanged
  output-parser.ts          — extended: parse [DECOMPOSITION] block
  prompt-templates.ts       — extended: lineage/siblings injection
  result-finalizer.ts       — unchanged
  preview-resolver.ts       — unchanged
  preview-server.ts         — unchanged
  resolve-path.ts           — unchanged
  config.ts                 — slimmed (constants moved to module defaults)
  types.ts                  — extended event types
  index.ts                  — public exports
```

### Deleted Files

| File | Replacement |
|------|-------------|
| `ai-backend.ts` | `agent/types.ts` |
| `worktree.ts` | `workspace/worktree.ts` |
| `retry.ts` | `reaction/engine.ts` |
| `memory.ts` (orchestrator) | already replaced by `packages/memory` |

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
| 3 | Task Decomposer | Phase 1 (reaction handles failures) | decomposer/, refactor delegation.ts + prompt-templates.ts |
| 4 | Agent Plugin | Phase 2 (workspace hooks) | agent/, refactor backends.ts + agent-session.ts |
| 5 | Notifier + Registry | Phase 1 + 4 | notifier/, plugin-registry.ts, new orchestrator API |

Phases 1 and 2 are independent and can be done in parallel.
Phase 3 depends on Phase 1 (reaction engine handles decomposer failures).
Phase 4 depends on Phase 2 (agent plugins call workspace hooks).
Phase 5 ties everything together.
