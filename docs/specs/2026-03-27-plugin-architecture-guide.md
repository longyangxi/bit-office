# Plugin Architecture — User Guide

How to use the new modular orchestrator system. Covers all 5 modules with usage examples, configuration, and extension points.

---

## Quick Reference

| Module | Import From | Status |
|--------|-------------|--------|
| Reaction Engine | `@bit-office/orchestrator` → `ReactionEngine, DEFAULT_RULES` | Live |
| Workspace | `@bit-office/orchestrator` → `WorktreeWorkspace` | Live |
| Task Decomposer | `@bit-office/orchestrator` → `TaskScheduler, tryParseDecomposition` | Standalone |
| Agent Plugin | `@bit-office/orchestrator` → `AgentPlugin` (type) | Types only |
| Notifier | `@bit-office/orchestrator` → `createWebSocketNotifier` | Standalone |
| Plugin Registry | `@bit-office/orchestrator` → `createPluginRegistry` | Standalone |

---

## 1. Reaction Engine

### What It Does

Replaces hardcoded retry/escalation logic with configurable rules. When an event fires (task failed, review failed, agent stuck, etc.), the engine matches it against rules and executes the appropriate action.

### Default Behavior (Zero Config)

Out of the box, the engine preserves existing behavior:

| Event | Action | After Retries |
|-------|--------|---------------|
| Task failed (not timeout, not delegated, not reviewer) | Retry up to 2x | Escalate to leader |
| Review VERDICT: FAIL | Send to dev for direct fix, 1x | Escalate to leader |
| Delegation budget exhausted | Force-finalize | — |
| Agent stuck 5+ minutes | Notify user | — |

### Custom Rules

Override rules via orchestrator options:

```typescript
import { createOrchestrator, type ReactionRule } from "@bit-office/orchestrator";

const myRules: ReactionRule[] = [
  // More aggressive retry — 5 attempts before escalation
  {
    trigger: "task:failed",
    match: { wasTimeout: false, isDelegated: false },
    action: "retry",
    retries: 5,
    escalateAction: "escalate-to-leader",
  },

  // Don't auto-fix review failures — always escalate to leader
  {
    trigger: "review:fail",
    action: "escalate-to-leader",
  },

  // Notify faster — 2 minutes instead of 5
  {
    trigger: "agent:stuck",
    thresholdMs: 120_000,
    action: "notify",
  },
];

const orc = createOrchestrator({
  workspace: "/path/to/workspace",
  backends: [...],
  reactions: myRules,  // replaces DEFAULT_RULES entirely
});
```

### Rule Anatomy

```typescript
interface ReactionRule {
  trigger: ReactionTrigger;     // which event to match
  match?: {                     // optional conditions (all must be true)
    role?: string;              // agent role filter ("Developer", "Code Reviewer")
    wasTimeout?: boolean;       // was the failure a timeout?
    isDelegated?: boolean;      // was the task delegated by leader?
    attempt?: { gte?: number }; // minimum attempt count
  };
  action: ReactionAction;       // what to do on match
  retries?: number;             // how many times before escalating
  escalateAction?: ReactionAction;  // what to do when retries exhausted
  thresholdMs?: number;         // for agent:stuck — idle threshold
}
```

**Triggers**: `task:failed` | `review:fail` | `agent:stuck` | `agent:error` | `delegation:budget` | `task:done`

**Actions**: `retry` | `send-to-agent` | `escalate-to-leader` | `notify` | `force-finalize`

### Using Engine Directly (Advanced)

```typescript
import { ReactionEngine, DEFAULT_RULES } from "@bit-office/orchestrator";

const engine = new ReactionEngine({ rules: DEFAULT_RULES });

// Handle an event
const result = engine.handle("task:failed", context);
// result.action: "retry" | "escalate-to-leader" | "no-match"
// result.attempt: 1
// result.maxRetries: 2

// Reset between team sessions
engine.reset();

// Clear tracking for a specific task
engine.clearTask("task-123");
```

---

## 2. Workspace (PostCreate Hooks)

### What It Does

Wraps git worktree operations behind a `Workspace` interface. Adds postCreate hooks to automatically set up worktrees with symlinks and commands after creation.

### Configuring PostCreate

```typescript
const orc = createOrchestrator({
  workspace: "/path/to/workspace",
  backends: [...],
  worktree: {
    mergeOnComplete: true,
    alwaysIsolate: true,
    postCreate: {
      // Symlink these from main repo into each worktree
      symlinks: [".env", ".claude", "node_modules"],

      // Run these commands after worktree creation
      commands: [
        "pnpm install --frozen-lockfile",
        "cp .env.example .env.local",
      ],
    },
  },
});
```

### What Happens on Agent Task Start

```
1. Agent gets assigned a task
2. Orchestrator calls workspace.create({ repoRoot, agentId, agentName })
3. Git worktree created at ~/.open-office-dev/worktrees/<repo>/<agentId>/
4. PostCreate fires (non-blocking):
   a. Symlink .env from main repo → worktree/.env
   b. Symlink .claude from main repo → worktree/.claude
   c. Run "pnpm install --frozen-lockfile" in worktree
5. Agent starts working in the worktree
```

### PostCreate Error Handling

PostCreate never fails the workspace creation. If `pnpm install` fails:
1. Warning logged: `[Workspace postCreate] Command failed: "pnpm install": ...`
2. Agent starts anyway
3. Agent encounters missing deps, fails
4. Reaction Engine retries (which re-enters the same worktree, deps might work on retry)

### Security Rules

- Symlink paths must be **relative** (no `/etc/passwd`)
- No `..` segments allowed (no `../../secrets`)
- Resolved path verified to stay **within workspace boundary**
- Commands come from **trusted config only** (OrchestratorOptions), never from agent output

### Using Workspace Directly (Advanced)

```typescript
import { WorktreeWorkspace } from "@bit-office/orchestrator";

const ws = new WorktreeWorkspace({
  postCreate: { symlinks: [".env"], commands: ["npm ci"] },
});

// Create
const info = ws.create({ repoRoot: "/repo", agentId: "agent-1", agentName: "Nova" });
// info = { path: "~/.open-office-dev/worktrees/repo-abc/agent-1", branch: "agent/nova-1", agentId: "agent-1" }

// Merge back to main
const result = ws.merge("/repo", info.path, info.branch, {
  keepAlive: true, summary: "Add snake game", agentName: "Nova", agentId: "agent-1",
});
// result = { success: true, commitHash: "abc123", commitMessage: "Nova: Add snake game" }

// Revert last commit on agent branch
ws.revert("/repo", info.path);

// Undo merge on main
ws.undoMerge("/repo", "abc123");

// Check for pending changes
ws.hasPendingChanges("/repo", info.path);

// Clean up
ws.destroy("/repo", info.path, info.branch);
```

---

## 3. Task Decomposer

### What It Does

Parses structured `[DECOMPOSITION]` blocks from Leader output into a task tree, then dispatches tasks in groups with lineage/siblings context injected into each worker's prompt.

### The [DECOMPOSITION] Format

Leader outputs this inside its response during execute phase:

```
I'll break this project into parallel workstreams.

[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Build the game board with PixiJS canvas" },
    { "id": "dev-2", "role": "Developer", "description": "Implement snake movement and keyboard controls" },
    { "id": "dev-3", "role": "Developer", "description": "Add food spawning, collision detection, and scoring" },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review all game code for bugs and performance" }
  ],
  "groups": [
    ["dev-1", "dev-2"],
    ["dev-3"],
    ["review-1"]
  ]
}
[/DECOMPOSITION]
```

**Rules**:
- `tasks[].id` — unique string, used in groups to reference tasks
- `tasks[].role` — matches to agent role for assignment
- `tasks[].description` — the actual task prompt
- `groups` — ordered list of execution groups
  - Group 1 `["dev-1", "dev-2"]`: both run **concurrently**
  - Group 2 `["dev-3"]`: runs **after** group 1 completes
  - Group 3 `["review-1"]`: runs **after** group 2 completes

### What Workers See

When dev-1 runs, its prompt includes:

```
## Task Hierarchy
0. Build a pixel snake game
  1. Build the game board with PixiJS canvas  <-- (this task)

## Parallel Work
Sibling tasks being worked on in parallel:
  - Implement snake movement and keyboard controls

Do not duplicate sibling work. If you need interfaces from siblings, define stubs.
```

This prevents workers from stepping on each other's toes.

### Parsing Output

```typescript
import { tryParseDecomposition, parseDecompositionBlock } from "@bit-office/orchestrator";

// Parse from Leader's full output
const plan = tryParseDecomposition(leaderOutput, "Build a snake game");

if (plan) {
  console.log(plan.tree.children.length); // 4 tasks
  console.log(plan.groups);               // [["dev-1","dev-2"], ["dev-3"], ["review-1"]]
  console.log(plan.phase);                // "approved"
} else {
  // No [DECOMPOSITION] block found — fall back to old delegation mode
}
```

### Running the Scheduler

```typescript
import { TaskScheduler } from "@bit-office/orchestrator";

const scheduler = new TaskScheduler(plan, (task, contextPrompt) => {
  // contextPrompt contains formatted lineage + siblings
  console.log(`Dispatching ${task.id} (${task.role}): ${task.description}`);
  console.log(`Context:\n${contextPrompt}`);

  // Your dispatch logic here:
  // orchestrator.runTask(agentId, task.id, task.description + "\n\n" + contextPrompt);
});

// Start — dispatches group 1
scheduler.start();

// When a task completes:
scheduler.taskCompleted("dev-1", "Built the canvas");
scheduler.taskCompleted("dev-2", "Movement working");
// → Group 1 done → automatically dispatches group 2

// When a task fails:
scheduler.taskFailed("dev-3", "Build error in collision.ts");
// → Group 2 done (failed) → dispatches group 3 anyway
// → Final status: plan.tree.status === "failed"

// Check completion
scheduler.isComplete();  // true when all groups processed
scheduler.getPlan();     // get current plan with updated statuses
```

### Context Formatting (Standalone)

```typescript
import { formatLineage, formatSiblings } from "@bit-office/orchestrator";

const lineage = formatLineage(
  ["Build e-commerce platform", "Backend services"],
  "Implement auth endpoint"
);
// Output:
// 0. Build e-commerce platform
//   1. Backend services
//     2. Implement auth endpoint  <-- (this task)

const siblings = formatSiblings(
  ["Implement auth", "Implement payments", "Implement orders"],
  "Implement auth"
);
// Output:
// Sibling tasks being worked on in parallel:
//   - Implement auth  <-- (you)
//   - Implement payments
//   - Implement orders
```

---

## 4. Agent Plugin

### What It Does

Defines a pluggable interface for AI backends. Each backend (Claude, Codex, Gemini, etc.) is a separate file implementing `AgentPlugin`.

### Creating a New Backend

```typescript
// apps/gateway/src/agents/my-new-agent.ts
import type { AgentPlugin } from "@bit-office/orchestrator";

export function createMyAgent(): AgentPlugin {
  return {
    id: "my-agent",
    name: "My Custom Agent",
    command: "my-agent-cli",
    stability: "experimental",
    guardType: "none",
    instructionPath: ".my-agent/rules.md",

    capabilities: {
      stdin: false,
      resume: false,
      agentType: false,
      nativeWorktree: false,
      structuredOutput: false,
    },

    buildArgs(prompt, opts) {
      const args = ["run", "--prompt", prompt];
      if (opts.model) args.push("--model", opts.model);
      if (opts.fullAccess) args.push("--no-sandbox");
      return args;
    },

    // Optional: activity detection for stuck detection
    detectActivity(session) {
      if (!session.lastOutputAt) return null;
      const idleMs = Date.now() - session.lastOutputAt;
      if (idleMs > 300_000) return "idle";
      return "active";
    },

    // Optional: extract session info for dashboard
    getSessionInfo(session) {
      return {
        summary: null,
        agentSessionId: null,
      };
    },
  };
}
```

### Registering in Gateway

```typescript
// apps/gateway/src/agents/index.ts
import { createMyAgent } from "./my-new-agent.js";

// Add to AGENT_FACTORIES array:
const AGENT_FACTORIES = [
  createClaudeCodeAgent,
  createCodexAgent,
  // ...
  createMyAgent,  // ← add here
];
```

### Available Backends (Built-in)

| ID | Name | Stability | Guard | Stdin | Resume | Structured Output |
|----|------|-----------|-------|-------|--------|-------------------|
| `claude` | Claude Code | stable | hooks | yes | yes | yes (stream-json) |
| `codex` | Codex CLI | stable | sandbox | no | no | no |
| `gemini` | Gemini CLI | beta | flag | no | no | no |
| `copilot` | GitHub Copilot | experimental | none | no | no | no |
| `cursor` | Cursor CLI | experimental | none | no | no | no |
| `aider` | Aider | experimental | none | no | no | no |
| `opencode` | OpenCode | experimental | none | no | no | yes (json) |
| `pi` | Pi | experimental | none | no | no | no |
| `sapling` | Sapling | experimental | none | no | no | yes (json) |

---

## 5. Notifier

### What It Does

Sends notifications when the Reaction Engine's `"notify"` action fires. Default implementation emits as an orchestrator event (picked up by WebSocket/Ably and shown in the web UI).

### Built-in: WebSocket Notifier

```typescript
import { createWebSocketNotifier } from "@bit-office/orchestrator";

const notifier = createWebSocketNotifier((event) => {
  // Forward to your WebSocket/transport layer
  wss.broadcast(JSON.stringify(event));
});

// Send a notification
await notifier.send({
  title: "Agent Nova is stuck",
  message: "No output for 5 minutes on task build-game",
  priority: "urgent",
  agentId: "agent-1",
  taskId: "task-1",
});
```

### Creating a Custom Notifier

```typescript
import type { Notifier, OrchestratorNotification } from "@bit-office/orchestrator";

function createSlackNotifier(webhookUrl: string): Notifier {
  return {
    name: "slack",
    async send(notification: OrchestratorNotification) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `[${notification.priority.toUpperCase()}] ${notification.title}\n${notification.message}`,
        }),
      });
    },
  };
}
```

### Notification Priority Levels

| Priority | When | Example |
|----------|------|---------|
| `urgent` | Needs immediate human attention | Agent stuck, agent error |
| `action` | Human action required but not time-sensitive | PR ready to merge |
| `warning` | Something went wrong, auto-handled | Auto-fix failed once |
| `info` | Informational | Task completed, summary |

---

## 6. Plugin Registry

### What It Does

A lightweight registry for organizing plugins by slot. Register instances, look them up by name.

### Usage

```typescript
import { createPluginRegistry, WorktreeWorkspace, createWebSocketNotifier } from "@bit-office/orchestrator";

const registry = createPluginRegistry();

// Register plugins
registry.register("workspace", "worktree", new WorktreeWorkspace());
registry.register("notifier", "websocket", createWebSocketNotifier(emit));
registry.register("notifier", "slack", createSlackNotifier(url));

// Look up
const ws = registry.get<Workspace>("workspace", "worktree");
const defaultNotifier = registry.getDefault<Notifier>("notifier"); // first registered

// List all notifiers
const notifiers = registry.list("notifier");
// [{ name: "websocket", slot: "notifier" }, { name: "slack", slot: "notifier" }]
```

### Slots

| Slot | Purpose | Default |
|------|---------|---------|
| `agent` | AI backend adapters | claude-code |
| `workspace` | Git isolation strategy | worktree |
| `notifier` | Notification channels | websocket |

---

## End-to-End Flow (Current)

```
User sends message
    │
    v
Gateway receives command (WebSocket/Ably/Telegram)
    │
    v
Orchestrator.runTask(agentId, taskId, prompt)
    │
    ├─ WorkspaceAdapter.create() → git worktree + postCreate hooks
    │
    ├─ AgentSession.spawn() → CLI process (claude -p "...")
    │
    v
Agent works (stdout streamed → output parser → events)
    │
    ├─ task:done → WorkspaceAdapter.merge() → worktree:merged event
    │
    ├─ task:failed → ReactionEngine.handle("task:failed", context)
    │   ├─ retry → session.prependTask() → agent retries
    │   ├─ escalate → leader gets escalation prompt
    │   └─ no-match → event emitted to UI
    │
    ├─ VERDICT: FAIL detected → DelegationRouter emits review:fail
    │   → ReactionEngine.handle("review:fail", context)
    │   ├─ send-to-agent → dev gets fix task (direct fix shortcut)
    │   └─ escalate → leader decides next step
    │
    v
Events forwarded to UI via WebSocket/Ably
```

## End-to-End Flow (Future — With Decomposer Wired)

```
User sends message
    │
    v
Leader agent produces [DECOMPOSITION] block
    │
    v
Parser extracts TaskNode tree + groups
    │
    v
Scheduler dispatches group 1 (concurrent tasks)
    │
    ├─ dev-1 gets: task prompt + lineage context + siblings list
    ├─ dev-2 gets: task prompt + lineage context + siblings list
    │   (each in own worktree with postCreate hooks)
    │
    v
Group 1 completes → Scheduler dispatches group 2
    │
    ├─ dev-3 gets: task prompt + lineage (knows what group 1 built)
    │
    v
Group 2 completes → Scheduler dispatches group 3
    │
    ├─ review-1: reviews all code
    │   ├─ PASS → plan done
    │   └─ FAIL → ReactionEngine handles (send-to-agent or escalate)
    │
    v
All groups done → plan.phase = "done"
```
