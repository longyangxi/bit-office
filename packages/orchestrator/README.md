# @bit-office/orchestrator

Multi-agent team collaboration engine. Manages agent lifecycles, task delegation, phase transitions, preview detection, and result finalization — all behind a typed event-driven API.

## Architecture

```
                         +------------------------+
                         |     Orchestrator        |
                         |   (EventEmitter)        |
                         +------------+-----------+
                                      |
    +--------+--------+-------+-------+-------+--------+--------+
    |        |        |       |       |       |        |        |
 Reaction Workspace  Agent  Decomp  Notifier Plugin   Legacy
 Engine   Adapter   Plugin  oser    (WS)    Registry  Modules
    |        |        |       |       |        |        |
 rules +  Worktree  Claude  Parser  send()  register DelegationRouter
 match +  PostCreate Codex  Sched.          get      PhaseMachine
 action   Symlinks   ...9   Context         list     AgentManager
          Commands                                    ResultFinalizer
```

**Key design decisions:**
- Orchestrator is a **pure logic library** — no I/O, no HTTP, no persistence. The consumer (gateway) handles all external concerns.
- All communication via **typed events** (`EventEmitter<OrchestratorEventMap>`). The consumer subscribes and forwards to its own transport (WebSocket, Ably, etc.).
- **Plugin-driven** — Reaction rules, workspace strategy, agent backends, and notifiers are pluggable via typed interfaces.
- **Backward compatible** — legacy `@AgentName:` delegation coexists with new `[DECOMPOSITION]` structured dispatch.

## Module Map

```
src/
  ── Plugin Modules (new) ──────────────────────────────────────
  reaction/
    engine.ts            Rule matching + action execution (replaces retry.ts)
    defaults.ts          Default rules: retry, review-fail, budget, stuck
    types.ts             ReactionTrigger, ReactionAction, ReactionContext, facades
  workspace/
    worktree.ts          WorktreeWorkspace adapter (wraps worktree.ts)
    post-create.ts       Symlink + command execution after workspace creation
    types.ts             Workspace interface, PostCreateConfig
  decomposer/
    parser.ts            Parse [DECOMPOSITION] blocks from leader output
    scheduler.ts         Group-based task dispatch + status propagation
    context.ts           formatLineage(), formatSiblings() for prompt injection
    types.ts             TaskNode, DecompositionPlan, DecomposerConfig
  agent/
    types.ts             AgentPlugin interface (superset of AIBackend)
  notifier/
    websocket.ts         WebSocket notifier (emits orchestrator events)
    types.ts             OrchestratorNotification, Notifier interface
  plugin-registry.ts     Lightweight register/get/list for 3 plugin slots
  agent-selector.ts      Role-based agent matching for decomposed tasks
  stuck-detector.ts      Polling loop for idle agent detection

  ── Core Modules ──────────────────────────────────────────────
  orchestrator.ts        Core engine: lifecycle, events, decomposition dispatch
  agent-session.ts       Process management: spawn, stream parse, timeout
  delegation.ts          Task routing: depth/budget limits, result batching, direct fix
  prompt-templates.ts    Typed templates (leader/worker/reviewer phases)
  memory.ts              Re-export shim for @bit-office/memory
  phase-machine.ts       State machine: CREATE -> DESIGN -> EXECUTE -> COMPLETE
  result-finalizer.ts    Team-level merge: changedFiles, preview, entryFile
  preview-resolver.ts    7-step cascading preview URL resolution
  preview-server.ts      Static serve (npx serve) + command execution
  output-parser.ts       Structured field extraction + decomposition re-export
  config.ts              Centralized constants (delegation, timing, preview)
  types.ts               All event types, options, payloads
  worktree.ts            Git worktree isolation (underlying implementation)
  agent-manager.ts       Session registry + team lead tracking
  resolve-path.ts        4-strategy path resolution for agent-reported paths
  ai-backend.ts          AIBackend interface (legacy, kept for compat)
  token-tracker.ts       Per-task token usage + cost calculation
  index.ts               Public exports + factory
```

## Team Collaboration Flow

```
User: "Build a pixel art snake game"
  |
  v
+----------+     [PLAN] detected     +----------+     User approves     +-----------+
|  CREATE  | ----------------------> |  DESIGN  | ------------------->  |  EXECUTE  |
| (vision) |  Leader outputs plan    | (refine) |  approvePlan()        | (build)   |
+----------+                         +----------+                       +-----------+
                                          ^                                  |
                                          |                    isFinalResult |
                                          |                                  v
                                     User sends                       +----------+
                                     feedback                         | COMPLETE |
                                     (loops back)                     | (report) |
                                                                      +----------+
```

### Execute Phase Detail

**Structured decomposition (new default):**

```
Leader (no tools, delegates only)
  |
  | Outputs [DECOMPOSITION] block:
  | { "tasks": [...], "groups": [["dev-1","dev-2"], ["review-1"]] }
  v
Orchestrator parses → creates TaskScheduler
  |
  | Group 1: dispatches dev-1 + dev-2 in parallel
  | (each gets lineage context + sibling awareness)
  v
Developers work concurrently (each in own worktree)
  |
  | Group 1 complete → Group 2 dispatched
  v
Code Reviewer evaluates
  |  VERDICT: PASS or FAIL
  |
  +-- PASS → plan complete (isFinalResult = true)
  |
  +-- FAIL → Reaction Engine decides:
              1st FAIL → send to dev for direct fix
              2nd FAIL → escalate to leader
```

**Legacy delegation (fallback):**

If the leader outputs `@AgentName: task` instead of a `[DECOMPOSITION]` block, the system falls back to the original `DelegationRouter` delegation path. Both modes coexist.

### Reaction Engine

Configurable event → action → escalation rules (replaces hardcoded `retry.ts`):

| Trigger | Default Action | After Retries | Configurable |
|---------|---------------|---------------|-------------|
| `task:failed` | Retry (2x) | Escalate to leader | retries, escalateAction |
| `review:fail` | Send to dev (1x) | Escalate to leader | retries, escalateAction |
| `delegation:budget` | Force-finalize | — | — |
| `agent:stuck` | Notify user (5 min) | — | thresholdMs |

Rules are passed via `OrchestratorOptions.reactions`. Default: `DEFAULT_RULES`.

```typescript
// Custom rules example
const orc = createOrchestrator({
  reactions: [
    { trigger: "task:failed", match: { wasTimeout: false, isDelegated: false },
      action: "retry", retries: 5, escalateAction: "escalate-to-leader" },
    { trigger: "agent:stuck", thresholdMs: 120_000, action: "notify" },
  ],
});
```

### Agent Selection

When the scheduler dispatches a decomposed task, agents are auto-selected:

1. **Exact role match** — idle agent whose role matches the task role
2. **Partial match** — "Senior Developer" matches a "Developer" task
3. **Any idle non-lead** — fallback
4. **No agent available** — task marked as failed, reaction engine handles

### Stuck Detection

A polling loop checks all `working` agents every 60 seconds. If an agent's `lastOutputAt` exceeds 5 minutes, the reaction engine triggers `agent:stuck` → notifies the user.

### Delegation Controls

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `maxDepth` | 5 | Max delegation chain hops |
| `maxTotal` | 20 | Total delegations per session |
| `budgetRounds` | 7 | Leader invocations before forced finalize |
| `hardCeilingRounds` | 10 | Absolute max rounds (deprecated — now via reaction rule) |
| `maxReviewRounds` | 3 | Code review iterations (deprecated — now via reaction rule) |
| `maxDirectFixes` | 1 | Direct fix attempts (deprecated — now via reaction rule) |

### Role Defaults

Each agent gets two capability flags at creation time, derived from its role. Both can be explicitly overridden via `canDelegate` / `noCode` in the agent session options.

| Role | `canDelegate` | `noCode` | Description |
|------|:---:|:---:|-------------|
| **Team Lead** | yes | yes | Pure coordinator — delegates only, no code |
| **Product Manager** | yes | yes | Plans, writes PRDs, delegates to devs |
| **Game Designer** | yes | yes | Designs gameplay, delegates implementation |
| **Narrative Designer** | yes | yes | Story/dialogue design, delegates scripting |
| **Level Designer** | yes | yes | Layout/pacing design, delegates building |
| **UI Designer** | yes | yes | Design systems, delegates code changes |
| **Software Architect** | yes | no | Designs + writes code (hybrid) |
| **Backend Architect** | yes | no | Designs + writes code (hybrid) |
| **Senior Developer** | no | no | Pure execution — writes code |
| **Frontend Developer** | no | no | Pure execution — writes code |
| **Rapid Prototyper** | no | no | Pure execution — writes code |
| **Code Reviewer** | no | yes | Reviews code, cannot write or delegate |

- **`canDelegate`**: Agent can detect `@AgentName: task` in its output and trigger delegation. Configured in `DELEGATOR_ROLES` (`config.ts`).
- **`noCode`**: Agent is instructed via prompt not to create/edit code files. It retains full tool access (read, search, run commands). Configured in `NO_CODE_ROLES` (`config.ts`).

## Agent Memory

Persistent cross-project learning system. Agents improve over time by remembering patterns from previous projects.

### What Gets Remembered

| Memory Type | Recorded When | Injected Into |
|-------------|---------------|---------------|
| **Review Patterns** | Reviewer outputs `VERDICT: FAIL` with numbered issues | Dev worker prompts (when same issue flagged ≥2 times) |
| **Tech Preferences** | Project completes with a `TECH:` line in the approved plan | Dev worker prompts (last 3 preferences shown) |
| **Project History** | `isFinalResult` fires on team completion | Stored for reference (not injected into prompts) |

### How It Works

- Storage: `~/.open-office[-dev]/data/memory/memory.json` (human-readable, persists across restarts)
- Memory is **global**, not per-agent — all dev workers in any team share the same learned context
- Only recurring patterns are injected (count ≥ 2), so one-off issues don't pollute prompts
- Review patterns are capped at top 20, tech preferences at last 10, project history at last 50

### Example Memory Injection

After two projects where the reviewer flagged "missing build step" and "no error handling in fetch calls", the next dev worker's prompt will include:

```
===== LEARNED FROM PREVIOUS PROJECTS =====
COMMON REVIEW ISSUES (avoid these):
- missing build step (flagged 2x)
- no error handling in fetch calls (flagged 3x)

USER'S PREFERRED TECH: Vanilla JS + Canvas, React + Tailwind
```

### API

```typescript
import { getMemoryStore, clearMemory } from "@bit-office/orchestrator";

// Inspect current memory
const store = getMemoryStore();
console.log(store.reviewPatterns);  // [{ pattern: "...", count: 3, lastSeen: ... }]
console.log(store.techPreferences); // ["Vanilla JS + Canvas", "React + Tailwind"]
console.log(store.projectHistory);  // [{ summary: "...", tech: "...", completedAt: ... }]

// Reset all memory
clearMemory();
```

## Worktree Isolation

When multiple agents work on the same repo, each agent gets its own **git worktree** — a physical copy of the working tree linked to the same repo, on its own branch. This prevents agents from stepping on each other's changes.

Worktrees are managed through the **Workspace** plugin interface (`workspace/types.ts`). The default implementation is `WorktreeWorkspace`.

### Design Principles

- **One agent = one worktree = one branch.** Worktree and branch are keyed by `agentId`, not `taskId`. This keeps the directory stable across tasks so Claude Code `--resume` works (same CWD).
- **Worktrees live outside the repo** at `~/.open-office[-dev]/worktrees/<repo-hash>/<agentId>/`. This prevents Claude Code from traversing up to the main repo root.
- **Branch naming:** `agent/<agentName>-<shortId>` (e.g. `agent/nova-pTTERq`). Unique per agent, human-readable.
- **Branches are local only** — never pushed to remote. Visible in SourceTree/git tools via shared `.git`.

### PostCreate Hooks (New)

After a worktree is created, optional hooks run automatically:

```typescript
const orc = createOrchestrator({
  worktree: {
    mergeOnComplete: true,
    alwaysIsolate: true,
    postCreate: {
      symlinks: [".env", ".claude"],                    // symlink from main repo
      commands: ["pnpm install --frozen-lockfile"],      // run in worktree
    },
  },
});
```

- **Symlinks**: relative paths only, validated against directory traversal
- **Commands**: from trusted config only, never from agent output
- **Error handling**: warnings logged, never fails workspace creation

### Lifecycle

```
Agent gets task
  │
  ├─ worktree exists? ──yes──> syncWorktreeToMain (rebase onto latest main)
  │                             skipped if pendingMerge=true
  │
  └─ no ──> git worktree add ~/.open-office[-dev]/worktrees/<repo>/<agentId>
            creates branch agent/<name>-<id>
            runs postCreate hooks (symlinks, pnpm install, etc.)
            session.clearHistory() (can't --resume in new CWD)
  │
  v
Agent works in worktree (commits on its branch)
  │
  v
Task completes (task:done)
  ├─ autoMerge=true (default):
  │    auto-commit → squash-merge → main
  │    reset branch to main HEAD (keepAlive)
  │    commitHash pushed to mergeCommitStack (for undo)
  │
  ├─ autoMerge=false (deferred):
  │    auto-commit → set pendingMerge=true
  │    UI shows merge/revert buttons, user decides when to merge
  │
  └─ Team worker: merge all at once when team finalizes
  │
  v
Agent removed (fired)
  └─ git worktree remove + git branch -D (full cleanup)
```

### Merge Control (per-agent)

Each agent has a per-agent `autoMerge` toggle (default: **true**) in the UI chat area.

**Auto-merge flow (default):**
1. Task completes → auto-commit + squash-merge to main → record commitHash
2. Test the changes in the running app
3. If broken → click **undo merge** (red button, shows confirmation with commit hash + message)
4. Can undo multiple merges — each undo pops one from the commit stack

**Deferred merge flow (autoMerge=false):**
1. Task completes → auto-commit to agent branch → `pendingMerge=true`
2. UI shows **merge to main** (green) + **revert** (yellow) buttons
3. **revert** = `git reset --hard HEAD~1` on agent branch (undo last agent commit, can click multiple times)
4. **merge to main** = squash-merge when ready
5. After merge, **undo merge** button appears (same as auto-merge flow)

**UI Controls (chat input area, both sidebar and console mode):**
- **merge to main** (green): squash-merge agent branch → main
- **revert** (yellow): undo last agent commit on branch (pre-merge)
- **undo merge** (red): `git revert <commitHash>` on main (post-merge, with confirmation dialog)
- **auto-merge** checkbox: toggle per-agent autoMerge preference
- All buttons disabled while agent is working

### Conflict Resolution

Conflicts are resolved automatically — no user intervention needed.

| Scenario | Strategy | Rationale |
|----------|----------|-----------|
| **Sync (before task)** | `-X theirs` (main wins) | Agent hasn't started new work; main is authoritative |
| **Merge (to main)** | `-X ours` (agent wins) | Agent's changes are the content being merged |

Both follow the same 3-tier approach:
1. Clean rebase (no auto-resolve)
2. If conflicts → rebase with strategy (`-X theirs` or `-X ours`)
3. If still fails → report error

### Dirty Files Safety

All merge/undo operations stash uncommitted files on main before operating, and restore them after:
- `mergeWorktree`: stash → merge → pop (on both success and failure paths)
- `undoMergeCommit`: stash → revert → pop (via try/finally)

### Cleanup

Worktrees are cleaned up only when an agent is **fired** (`removeAgent`). No startup GC — worktrees carry meaningful unmerged state that must survive gateway restarts. On restart, `detectPendingMerges()` scans existing worktrees and sets `pendingMerge=true` if they have uncommitted changes or commits ahead of main.

### Commands & Events

| Command | Params | Description |
|---------|--------|-------------|
| `MERGE_WORKTREE` | agentId | Manually merge agent's worktree to main |
| `REVERT_WORKTREE` | agentId | Undo last commit on agent's branch |
| `UNDO_MERGE` | agentId | Revert the last merge commit on main |
| `TOGGLE_AUTO_MERGE` | agentId, autoMerge | Toggle per-agent auto-merge |

| Event | Key Fields | Description |
|-------|------------|-------------|
| `worktree:created` | agentId, worktreePath, branch | Git worktree created |
| `worktree:merged` | agentId, success, commitHash?, commitMessage? | Worktree squash-merged to main |
| `worktree:ready` | agentId, branch | Worktree has changes ready for manual merge |
| `autoMerge:updated` | agentId, autoMerge, lastMergeCommit? | Per-agent merge preference changed |

**State persistence:**
- `autoMerge`: persisted in `team-state.json`, restored on restart
- `pendingMerge`: reconstructed from git state on restart via `detectPendingMerges()`
- `mergeCommitStack`: rebuilt from git log on restart via `getMergeHistory()` — undo survives restarts

### Configuration

```typescript
const orc = createOrchestrator({
  worktree: {
    mergeOnComplete: true,    // enable worktree merge infrastructure
    alwaysIsolate: true,      // create worktree even for solo agents
  },
  // or: worktree: false      // disable worktree isolation entirely
});
// Per-agent: session.autoMerge (default: true)
```

### Directory Layout

```
~/.open-office-dev/              # dev mode (release: ~/.open-office/)
├── config.json
├── machine-id
├── data/
│   ├── instances/               # per-gateway state (logs, sessions, memory)
│   ├── memory/                  # global memory
│   ├── project-history/         # archived project records
│   ├── prompts/                 # custom prompt templates
│   └── agents.json              # agent definitions
├── projects/                    # agent working directories (default workspace)
└── worktrees/                   # centralized worktree storage
    └── bit-office-a3f2b1/       # grouped by source repo
        ├── agent-pTTERq/        # one dir per agent (stable across tasks)
        ├── agent-1gZQUa/
        └── .owners/             # ownership metadata for GC
```

## Preview Resolution

When a task completes, preview URL is resolved through a **7-step cascading fallback**:

```
1. PREVIEW_CMD + PREVIEW_PORT  -->  Run server, proxy via port
2. PREVIEW_CMD (no port)       -->  Desktop/CLI app (user launches manually)
3. ENTRY_FILE (.html)          -->  Static serve via npx serve:9100
4. "PREVIEW: http://..." in stdout  -->  Explicit URL from agent
5. .html path mentioned in stdout   -->  Regex extraction
6. .html in changedFiles       -->  Static serve
7. Build output scan           -->  dist/index.html, build/index.html, etc.
```

At the team level, `ResultFinalizer` adds two additional layers before this chain:
- **Worker ground truth** — dev worker's preview fields override leader's (leader often hallucinates filenames)
- **Worker detectPreview scan** — iterate all workers' output for preview URLs

## Usage

### Basic Setup

```typescript
import { createOrchestrator } from "@bit-office/orchestrator";
import type { AIBackend } from "@bit-office/orchestrator";

const claude: AIBackend = {
  id: "claude",
  name: "Claude",
  command: "claude",
  buildArgs(prompt, opts) {
    const args = ["-p", prompt, "--output-format", "stream-json"];
    if (opts.continue && opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
    if (opts.fullAccess) args.push("--dangerously-skip-permissions");
    if (opts.noTools) args.push("--allowedTools", "");
    return args;
  },
};

const orc = createOrchestrator({
  workspace: "/path/to/workspace",
  backends: [claude],
  retry: { maxRetries: 2, escalateToLeader: true },
  promptsDir: "~/.my-app/prompts",  // optional: override prompt templates on disk
});
```

### Event Handling

```typescript
// All 16 event types are fully typed
orc.on("task:started", (e) => {
  console.log(`${e.agentId} started task ${e.taskId}`);
});

orc.on("task:done", (e) => {
  if (e.isFinalResult) {
    console.log("Team finished!", e.result?.previewUrl);
  }
});

orc.on("team:phase", (e) => {
  console.log(`${e.teamId}: phase -> ${e.phase}`);
});

orc.on("team:chat", (e) => {
  // messageType: "delegation" | "result" | "status"
  console.log(`[${e.messageType}] ${e.fromAgentId}: ${e.message}`);
});
```

### Solo Agent

```typescript
orc.createAgent({
  agentId: "agent-1",
  name: "Dev",
  role: "Developer",
});

orc.runTask("agent-1", "task-1", "Build a landing page");
```

### Team Workflow

```typescript
// 1. Create agents
orc.createAgent({ agentId: "lead-1", name: "PM", role: "Team Lead" });
orc.createAgent({ agentId: "dev-1",  name: "Leo", role: "Developer" });
orc.createAgent({ agentId: "rev-1",  name: "Ada", role: "Code Reviewer" });
orc.setTeamLead("lead-1");

// 2. Start in CREATE phase — leader produces a [PLAN]
orc.setTeamPhase("team-1", "create", "lead-1");
orc.runTask("lead-1", "task-1", "Build a pixel snake game", {
  phaseOverride: "create",
});

// 3. Leader outputs [PLAN] -> auto-transitions to DESIGN phase
// 4. User reviews plan, provides feedback or approves

// 5. Approve plan -> transitions to EXECUTE phase
orc.approvePlan("lead-1");
orc.setTeamProjectDir("/workspace/snake-game");
orc.runTask("lead-1", "task-2", "Start building", {
  phaseOverride: "execute",
});

// 6. Leader delegates to Dev, Dev builds, Reviewer reviews
//    All handled automatically by DelegationRouter

// 7. isFinalResult fires on task:done -> COMPLETE phase
// 8. User sends feedback -> auto-transitions back to EXECUTE
```

### State Persistence (Consumer Side)

```typescript
// Save
const agents = orc.getAllAgents();
const phases = orc.getAllTeamPhases();
const projectDir = orc.getTeamProjectDir();
fs.writeFileSync("state.json", JSON.stringify({ agents, phases, projectDir }));

// Restore
const state = JSON.parse(fs.readFileSync("state.json", "utf-8"));
for (const agent of state.agents) {
  orc.createAgent({ ...agent, resumeHistory: true });
  if (agent.isTeamLead) orc.setTeamLead(agent.agentId);
}
for (const phase of state.phases) {
  orc.setTeamPhase(phase.teamId, phase.phase, phase.leadAgentId);
}
if (state.projectDir) orc.setTeamProjectDir(state.projectDir);
```

## Event Reference

| Event | Key Fields | When |
|-------|-----------|------|
| `task:started` | agentId, taskId, prompt | Agent begins a task |
| `task:done` | agentId, result, isFinalResult? | Agent completes a task |
| `task:failed` | agentId, error | Agent task fails |
| `task:delegated` | fromAgentId, toAgentId, prompt | Leader delegates to worker |
| `task:result-returned` | fromAgentId, toAgentId, summary | Worker result forwarded to leader |
| `task:retrying` | agentId, attempt, maxRetries | Auto-retry in progress |
| `task:queued` | agentId, position | Task queued (agent busy) |
| `agent:status` | agentId, status | Status change (idle/working/done/error) |
| `agent:created` | agentId, name, role, isTeamLead? | New agent registered |
| `agent:fired` | agentId | Agent removed |
| `approval:needed` | approvalId, riskLevel | Agent requests permission |
| `log:append` | agentId, stream, chunk | Real-time output stream |
| `team:chat` | fromAgentId, message, messageType | Team communication |
| `team:phase` | teamId, phase, leadAgentId | Phase transition |
| `worktree:created` | agentId, worktreePath, branch | Git worktree created |
| `worktree:merged` | agentId, success, commitHash?, commitMessage? | Worktree squash-merged to main |
| `worktree:ready` | agentId, branch | Worktree ready for manual merge |
| `autoMerge:updated` | agentId, autoMerge, lastMergeCommit? | Per-agent merge preference changed |

## Configuration

All magic numbers are centralized in `config.ts`:

```typescript
import { CONFIG } from "@bit-office/orchestrator";

CONFIG.delegation.maxDepth          // 5
CONFIG.delegation.maxTotal          // 20
CONFIG.delegation.budgetRounds      // 7
CONFIG.delegation.hardCeilingRounds // 10
CONFIG.delegation.maxReviewRounds   // 3
CONFIG.delegation.maxDirectFixes    // 1 (direct reviewer→dev fix attempts before leader)

CONFIG.timing.leaderTimeoutMs       // 3 min
CONFIG.timing.workerTimeoutMs       // 8 min
CONFIG.timing.resultBatchWindowMs   // 20s (safety net for batch flushing)
CONFIG.timing.idleDoneDelayMs       // 5s
CONFIG.timing.idleErrorDelayMs      // 3s

CONFIG.preview.staticPort           // 9100
CONFIG.preview.buildOutputCandidates // ["dist/index.html", ...]
CONFIG.preview.runners              // { ".py": "python3", ".js": "node", ... }
```

## Prompt Templates

15 templates with compile-time typed names (`TemplateName` union). Templates are embedded as defaults and optionally overridden from disk (`promptsDir`).

| Template | Phase | Used When |
|----------|-------|-----------|
| `leader-create` | CREATE | First turn: leader as Creative Director |
| `leader-create-continue` | CREATE | Follow-up conversation |
| `leader-design` | DESIGN | User provides plan feedback |
| `leader-design-continue` | DESIGN | Continued refinement |
| `leader-initial` | EXECUTE | First execute entry (full delegation rules) |
| `leader-continue` | EXECUTE | Follow-up execute (keeps context) |
| `leader-result` | EXECUTE | Leader receives worker/reviewer results |
| `leader-complete` | COMPLETE | Present results to user |
| `leader-complete-continue` | COMPLETE | User feedback on completion |
| `worker-initial` | EXECUTE | Developer task assignment |
| `worker-reviewer-initial` | EXECUTE | Code reviewer task |
| `worker-continue` | EXECUTE | Follow-up to worker |
| `worker-direct-fix` | EXECUTE | Direct fix after reviewer FAIL (skips leader) |
| `delegation-prefix` | EXECUTE | Wraps delegated task prompts |
| `delegation-hint` | EXECUTE | Delegation syntax helper |

Templates use `{{variable}}` substitution. Key variables include `{{memory}}` (injected from Agent Memory for dev workers) and `{{soloHint}}` (solo mode instructions). Override any template by placing a `<template-name>.md` file in `promptsDir`.

## Owner Metadata (Multi-Instance Safety)

Each worktree has an owner file at `<worktreeDir>/.owners/<agentId>.json`:

```typescript
interface WorktreeOwnerInfo {
  gatewayId: string;
  machineId: string;
  instanceDir: string;
  pid: number;
  startedAt: number;
  agentId: string;
  agentName: string;
  branch: string;
  repoRoot: string;
}
```

This enables safe cleanup across multiple gateway instances (Tauri / Web / CLI). A worktree is only cleaned up if its owning runtime is dead (PID check + heartbeat TTL via `RuntimeOwnerInfo`). The `shouldCleanWorktree()` function checks:
1. Same gateway instance + same startedAt → clean (stale from previous run)
2. Owner's runtime PID is dead or heartbeat expired → clean
3. Otherwise → skip (another live instance owns it)

## Activity Board (Real-time Awareness)

When multiple agents work concurrently, they need awareness of each other's activities.

### Event Protocol

```typescript
interface AgentActivityEvent {
  type: "agent:activity";
  agentId: string;
  agentName: string;
  intent: string;       // Task description (first CONFIG.limits.intentChars chars)
  phase: "started" | "completed";
}
```

### Broadcast Points
- **Delegation start** (`delegation.ts`): emitted when a worker receives a task
- **Task completion** (`delegation.ts`): emitted when a worker returns a result

### Worker Team Context

Workers receive a lightweight team awareness block (~30 tokens per peer) via `buildWorkerTeamContext()`:

```
===== TEAM AWARENESS =====
Your teammates (for context -- do NOT delegate or coordinate with them):
- Leo (Developer) [working] -- feat: implement game loop...
- Ada (Code Reviewer) [idle]
```

This shows peer names, roles, statuses, and last results — enough to avoid file conflicts without overwhelming the prompt.

## Persistence

### Agent State

File: `~/.open-office[-dev]/data/instances/<id>/team-state.json` (instance-scoped)

```typescript
interface PersistedAgent {
  agentId: string;
  name: string;
  role: string;
  personality?: string;
  backend?: string;
  palette?: number;
  teamId?: string;
  isTeamLead?: boolean;
  workDir?: string;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  autoMerge?: boolean;
}

interface PersistedTeam {
  teamId: string;
  leadAgentId: string;
  phase: "create" | "design" | "execute" | "complete";
  projectDir: string | null;
  originalTask?: string | null;  // Leader's approved plan -- survives restart
}
```

- Saved on: CREATE_AGENT, FIRE_AGENT, team:phase changes, gateway shutdown
- Atomic write via tmp file + rename (prevents truncation on kill)
- `loadTeamState()` restores all agents on startup (no filtering)
- Solo agents are NOT removed when creating a team

### Session Context
- Agent sessions store agentId -> Claude Code session ID mapping
- Conversation history lives in `~/.claude/projects/` (managed by Claude Code)
- On restart: `--resume <sessionId>` continues the conversation
- Session IDs should NOT be cleared — causes context loss

### Project History

File: `~/.open-office[-dev]/data/project-history/<startedAt>-<name>.json`

Completed projects are archived with all events, agents, team state, preview info, token usage, and ratings. Event buffer is persisted to `project-events.jsonl` (instance-scoped) so archives survive gateway restarts.

## External Agent Output

External agents (detected by process scanner) bypass the orchestrator entirely:
- Output read from `~/.claude/projects/` JSONL files by `external-output-reader.ts`
- Text blocks sent as LOG_APPEND events (no truncation, 500ms throttle)
- Frontend accumulates chunks into growing messages (10s window per message block)
- No TASK_DONE event — streaming messages are the final display

## Console Mode (UI)

Terminal-style chat interface with CRT effects:
- **Layout**: Left vertical tab bar (Agents/Team/External) + top horizontal agent strip + full-height chat
- **Visual**: JetBrains Mono font, green terminal theme (#18ff62), CRT scanlines, screen flicker
- **Messages**: Terminal log format with timestamps and agent name tags `[Marcus]`
- **Input**: Always-visible `>` prompt, ESC to stop working agent, type to continue
- **Streaming**: Real-time output via LOG_APPEND, typewriter reveal effect
- **Completion**: Duration display (e.g. "Brewed for 1m 45s")
- **Working indicator**: Animated dots `...` in streaming message, `>_` when idle
- **Console toggle**: Button on sidebar left edge, expands chat to full screen (unmounts PixiJS scene)

## Team Execution Notes

- Leader's non-delegation responses in execute phase are treated as conversational replies (marked `isFinalResult`, phase returns to complete)
- Streaming messages (`-stream` suffix) are cleaned up on: TASK_DONE, TASK_FAILED, TASK_STARTED (stale cleanup), and leader intermediate completions
- Direct fix shortcut: reviewer FAIL -> dev (skip leader) -> auto re-review -> escalate to leader if still failing

## Implementation Status

| Phase | Content | Status |
|-------|---------|--------|
| Phase 1 | Working directory config (workDir, PICK_FOLDER, persistence) | Done |
| Phase 2 | Git worktree isolation (centralized storage, team + solo, alwaysIsolate) | Done |
| Phase 3 | Conflict detection (git merge-tree dry-run, rebase-then-retry) | Done |
| Phase 4 | Activity Board (agent:activity event, worker team context injection) | Done |
| Phase 5 | Exports/Needs dependency graph + prompt injection | Planned |

## Key File Index

| File | Responsibility |
|------|---------------|
| `src/worktree.ts` | Git worktree CRUD + env isolation -- `createWorktree` (centralized), `mergeWorktree` (squash + rebase-retry), `removeWorktree`, `checkConflicts` (git 2.38+ with fallback), `cleanupStaleWorktrees` (owner-aware), `getIsolatedGitEnv`, `syncWorktreeToMain`, `undoMergeCommit`, `resetWorktreeToMain`, `revertWorktreeCommit`, `getMergeHistory`, `initGitRepo` |
| `src/delegation.ts` | `DelegationRouter` -- `prepareWorktree` callback, batched result forwarding, direct fix shortcut (reviewer->dev->re-review), budget/ceiling enforcement, worker team context |
| `src/orchestrator.ts` | Core engine -- `prepareWorktree()`, `hasSoloNeighbor()`, `alwaysIsolate`, `mergeAllWorktrees()`, `detectPendingMerges()`, `undoMerge()`, `setAutoMerge()`, `manualMerge()`, `revertLastCommit()` |
| `src/agent-session.ts` | Process management -- `worktreePath`/`worktreeBranch` storage, CWD resolution (worktree > repoPath > workspace), stale worktree auto-clear, conditional cleanup on failure |
| `src/memory.ts` | Persistent learning -- review patterns, tech prefs, project history |
| `src/phase-machine.ts` | State machine: CREATE -> DESIGN -> EXECUTE -> COMPLETE |
| `src/result-finalizer.ts` | Team merge: changedFiles, preview, entryFile |
| `src/preview-resolver.ts` | 7-step cascading preview URL resolution |
| `src/prompt-templates.ts` | 15 typed templates (leader/worker/reviewer/direct-fix) |
| `src/config.ts` | Centralized constants (delegation, timing, preview, limits) |
| `apps/gateway/src/index.ts` | Gateway -- `agentWorkDirs`, `git init` on APPROVE_PLAN, event forwarding, `worktreeEnabled` toggle |
| `apps/gateway/src/team-state.ts` | State persistence -- instance-scoped, atomic write, project history archive |
| `apps/gateway/src/external-output-reader.ts` | External agent output -- JSONL reader, 500ms throttle |
| `apps/web/src/app/office/page.tsx` | UI -- console layout, terminal messages, typewriter effect |
| `apps/web/src/store/office-store.ts` | Store -- streaming message lifecycle, external agent text accumulation |

## Rejected Approaches

| Approach | Reason |
|----------|--------|
| CRDTs (Yjs/Automerge) | AI agents write entire files, not character-by-character edits -- wrong abstraction level |
| Python frameworks (MetaGPT/CrewAI) | Not Node.js native, and they don't solve file conflicts |
| Pure file locking (no worktree) | LLM agents are unpredictable -- they may ignore locks and write files directly |
| Custom merge algorithms | Git's three-way merge is already optimal -- no need to reinvent the wheel |
| External clash CLI | Native `git merge-tree` achieves the same goal without extra dependencies |
| Clearing session on error | Causes context loss -- session should be preserved for retry |
| In-repo `.worktrees/` directory | Path traversal issues -- agents walk up to find project root and hit worktree dirs |
| Startup GC for stale worktrees | Could destroy worktrees with pending unmerged changes -- replaced by owner-aware cleanup |
