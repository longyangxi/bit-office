# Multi-Agent Coordination

## Overview

When multiple solo agents or team members work on the same project, three core problems must be solved:
1. **Conflict Prevention** — prevent multiple agents from modifying the same file simultaneously
2. **Real-time Awareness** — each agent knows what others are doing
3. **Mutual Benefit** — agents can reuse each other's outputs

## Architecture

Hybrid approach: **Git Worktree hard isolation + Activity Board soft coordination**.

```
┌──────────────────────────────────────────────┐
│          Project Coordinator                 │
│  • git worktree management (hard isolation)  │
│  • activity board (soft coordination)        │
│  • conflict detection (git merge-tree)       │
│  • merge sequencing                          │
└──────┬──────────┬──────────┬─────────────────┘
       │          │          │
  worktree-a  worktree-b  worktree-c
  ┌────▼──┐  ┌────▼──┐  ┌───▼───┐
  │Dev A  │  │Dev B  │  │Dev C  │
  └───┬───┘  └───┬───┘  └───┬───┘
      │          │          │
      ▼          ▼          ▼
   branch-a   branch-b   branch-c
      │          │          │
      └────┬─────┘     ┌───┘
           ▼           ▼
      git merge (sequential)
           │
           ▼
        main branch
```

## Working Directory Configuration

### Solo Agent
- A custom `workDir` can be specified when hiring an agent (Browse button opens native macOS folder picker via gateway, or paste full path)
- If not specified, the built-in default workspace is used (gateway's `defaultWorkspace`)
- `workDir` is stored in gateway's `agentWorkDirs` map and passed as `repoPath` with every `RUN_TASK`
- `PICK_FOLDER` command triggers native macOS folder dialog (`osascript` → `choose folder`), returns full path via `FOLDER_PICKED` event
- Solo agents and their workDir are persisted to `team-state.json` and survive gateway restarts

### Team Mode
- A custom `workDir` can be specified when creating a team (parent directory for projects)
- On `APPROVE_PLAN`, the gateway runs `git init` + initial commit, then creates a unique project subdirectory
- All team members share the same `teamProjectDir`
- If not specified, `config.defaultWorkspace` is used

### Priority Order
```
RUN_TASK repoPath > agent workDir > team workDir > config.defaultWorkspace
```

## Layer 1: Git Worktree Isolation (Conflict Prevention)

### Principle
Each dev agent works in its own git worktree, physically isolating the filesystem. Even if an agent ignores conventions, it cannot affect other agents' files. Git enforces isolation at the branch level.

### Centralized Worktree Storage
All agent worktrees live **outside** the repo at:
```
~/.open-office[-dev]/worktrees/<repo-name>-<hash>/
```
This prevents path traversal issues (Claude Code / agents walking up to find project root, CLAUDE.md, etc.). The hash is derived from the absolute repo root path.

### Worktree Naming
- **Path**: `~/.open-office[-dev]/worktrees/<repo-name>-<hash>/<agentId>`
- **Branch**: `agent/<agent-name>-<shortId>` (e.g. `agent/alex-uFZPTQ`)
- Agent name is sanitized (lowercased, spaces to hyphens), shortId strips the `agent-` prefix

### When Worktrees Are Created

| Scenario | Worktree? | Created By |
|----------|-----------|------------|
| Solo agent, unique workDir, `alwaysIsolate=false` | No | — |
| Solo agent, shares workDir with another solo agent | Yes (auto) | `orchestrator.ts` detects neighbor via `hasSoloNeighbor()` |
| Solo agent, `alwaysIsolate=true` (default when worktree enabled) | Yes (always) | `orchestrator.prepareWorktree()` |
| Team dev agent (delegated by leader) | Yes | `delegation.ts` calls `prepareWorktree()` callback → orchestrator |
| Team leader | No | — (leaders don't write code) |
| Team reviewer | No | — (reviews on main branch) |

### Team Mode Flow
1. On `APPROVE_PLAN`, gateway creates project dir → `git init` → initial commit
2. Leader delegates tasks → `delegation.ts` calls `prepareWorktree()` callback per dev agent
3. Orchestrator creates worktree at `~/.open-office[-dev]/worktrees/<repo-hash>/<agentId>` with branch `agent/<name>-<shortId>`
4. Each dev agent works in its own worktree (isolated cwd)
5. On task completion: auto-merge back to main via `git merge --squash` (keepAlive=true for session continuity)
6. Reviewer reviews on main branch (after merge)
7. Direct fix loop: reviewer FAIL → dev fix → auto re-review (bypasses leader, max `CONFIG.delegation.maxDirectFixes` attempts)

### Solo Multi-Agent Flow
1. With `alwaysIsolate=true` (default): every solo agent gets a worktree immediately
2. With `alwaysIsolate=false`: first solo agent works on main; second solo agent targeting the same workDir → `hasSoloNeighbor()` detects it → auto-creates worktree
3. On completion: merge back to main (keepAlive=true — worktree persists for next task)
4. Requires workDir to be a git repo (non-git dirs are auto-initialized with `initGitRepo()`)

### Non-Git Workspace Auto-Init
When an agent's workspace is not a git repo and worktree isolation is needed, `initGitRepo()` automatically runs `git init` + `git add -A` + initial commit so worktrees can be created.

### Native vs Managed Worktrees

| Mode | Mechanism | Status |
|------|-----------|--------|
| **Managed** (centralized) | orchestrator creates worktree via `git worktree add`, agent runs in isolated dir | Active |
| **Native** (`--worktree` flag) | Claude Code's built-in worktree support | Incompatible with `-p` and `--resume` (exit code 1) |

All backends use **managed worktrees** (`~/.open-office[-dev]/worktrees/<repo-hash>/<agentId>`) regardless of native support. The `useNativeWorktree` field on `AgentSession` exists but is always `false`.

### Git Environment Isolation

`worktree.ts` exports `getIsolatedGitEnv()` which clears leaked git env vars (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, etc.) and sets `HUSKY=0` before every git subprocess. This prevents one worktree's commands from accidentally targeting another repo — a subtle bug that caused cross-contamination in early versions.

All agent subprocess spawns (`agent-session.ts`) use this isolated env as the base, then further strip backend-specific vars (`deleteEnv`).

### Owner Metadata (Multi-Instance Safety)

Each worktree has an owner file at `<worktreeDir>/.owners/<agentId>.json` containing:
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
This enables safe cleanup across multiple gateway instances (Tauri / Web / CLI). A worktree is only cleaned up if its owning runtime is dead (PID check + heartbeat TTL).

### Merge Strategy: Squash

`mergeWorktree()` uses `git merge --squash` — the agent's work appears as staged changes on main (clean diff). A commit is created with the format: `<agentName>: <summary> [<agentId>]` (the agentId tag enables `getMergeHistory()` lookups).

On squash-merge conflict:
1. First attempt: rebase agent branch onto main, then retry squash merge
2. Rebase fallback: `-X ours` (agent's changes win for conflicting hunks)
3. If all fails: `git reset --hard HEAD` rollback, conflict files reported

Before merge, any uncommitted changes in the worktree are auto-committed (`autoCommitWorktree`). Main repo dirty state is stashed/unstashed around the merge.

### keepAlive Behavior

Solo agent merges use `keepAlive=true` — the worktree is NOT deleted after merge. Instead, the worktree branch is reset to the new main HEAD so the next task reuses the same worktree. This preserves session continuity (same CWD across tasks).

Team merges during finalization use `keepAlive=false` — worktree and branch are fully removed.

### Merge History and Undo

- `getMergeHistory(workspace, agentId)` scans git log for commits tagged with `[agentId]` — returns oldest-first list, filtering out reverted commits
- `undoMergeCommit(workspace, commitHash)`:
  - If commit is HEAD → `git reset --hard HEAD~1` (clean removal)
  - If other commits came after → `git revert` (creates reverse commit, uses `-m 1` for merge commits)
- `resetWorktreeToMain()` syncs the agent's worktree branch to the new main HEAD after an undo (eliminates fork)

### Worktree Path Priority in CWD Resolution

```
session.worktreePath > repoPath (from RUN_TASK) > session.workspace
```

If `worktreePath` no longer exists on disk (stale state from ungraceful shutdown), the session auto-clears it and falls back. This prevents spawn-failure → 0-output → session-clear cascades.

### Persistence and Restore

- `team-state.json` (instance-scoped: `~/.open-office[-dev]/data/instances/<id>/team-state.json`) persists `worktreePath` and `worktreeBranch` per agent
- On gateway restart, `orchestrator.restoreAgentWorktree()` validates the path exists on disk before restoring — stale paths are silently skipped
- `detectPendingMerges()` runs after all agents are restored: checks each worktree for unmerged changes → auto-merges if `autoMerge=true`, otherwise emits `worktree:ready` event

### Auto-Cleanup on Failure

When an agent task fails (non-zero exit), `agent-session.ts` auto-removes the orphaned worktree + branch — **except** for transient API errors (overloaded, rate limit, etc.), where the worktree is preserved for retry since the agent may have committed work before hitting the limit. Cleanup runs in a try/catch so failure never masks the original error.

### Startup GC

Startup GC was intentionally **removed** because it could destroy worktrees with pending unmerged changes. Cleanup now only happens:
- On fire agent (force-removes worktree + branch)
- On task failure (conditional, see above)
- Via `cleanupStaleWorktrees()` which uses owner metadata to determine if a worktree is truly orphaned (dead PID + expired heartbeat)

### Safety: Worktree Operations Never Block Team Flow
- **delegation.ts**: `prepareWorktree()` is called as a callback from delegation, but worktree creation failure does NOT block task delegation
- **orchestrator.ts**: worktree handling in `handleSessionEvent` for solo agents — merge failure does NOT block result emission
- **orchestrator.ts**: all worktree operations wrapped in try/catch
- **mergeAllWorktrees()**: called on team finalization, each worker's merge is independent — one failure doesn't block others

## Layer 2: Conflict Detection (Pre-merge Safety)

### Approach
Uses native `git merge-tree --write-tree` for dry-run conflict detection (requires git 2.38+). Falls back to `git merge --no-commit --no-ff` + abort on older git versions.

### Implementation
Located in `packages/orchestrator/src/worktree.ts`:
```typescript
export function checkConflicts(workspace: string, branch: string): string[] {
  // git merge-tree --write-tree does a dry-run merge (git 2.38+)
  // Falls back to git merge --no-commit --no-ff + abort on older git
  // Returns list of conflicting file paths, or empty array if clean
}
```

### Trigger Points
- Available for pre-merge validation
- On conflict during actual merge: `mergeWorktree()` attempts rebase-then-retry before reporting failure
- If conflicts detected in merge:
  - `git reset --hard HEAD` rolls back main
  - `MergeResult` returns `success: false` with `conflictFiles`
  - `worktree:merged` event emitted with `success: false`

## Layer 3: Activity Board (Real-time Awareness)

### Event Protocol
```typescript
interface AgentActivityEvent {
  type: "agent:activity";
  agentId: string;
  agentName: string;
  intent: string;              // Task description (first CONFIG.limits.intentChars chars)
  phase: "started" | "completed";
}
```

### Current Implementation
- `agent:activity` event emitted on delegation start and task completion in `delegation.ts`
- Events forwarded and logged by gateway
- Workers receive lightweight **team context** (`buildWorkerTeamContext`) showing peer names, roles, statuses, and last results (~30 tokens per peer)

### Planned (Phase 5)
- Inject other agents' activity summaries into current agent's system prompt
- `exports`/`needs` dependency graph for interface contract broadcasting
- File ownership map for soft coordination

## Direct Fix Shortcut (Reviewer → Dev)

When a Code Reviewer emits `VERDICT: FAIL`, the delegation router can bypass the leader and route fixes directly to the dev:

1. **First FAIL**: Route directly to dev with reviewer's feedback (skip leader round-trip)
2. **Subsequent FAILs** (up to `CONFIG.delegation.maxDirectFixes`): Continue direct fix loop
3. **After max attempts**: Escalate to leader for a different approach

On direct fix completion, an **auto re-review** is triggered — the reviewer gets the fix report plus their original review context for continuity (survives `--resume` failures).

Tracked state: `devFixAttempts` per dev agent, `lastDevAgentId` for routing, `reviewContext` carried through fix→re-review cycle.

## Persistence

### Agent State (`~/.open-office[-dev]/data/instances/<id>/team-state.json`)
- All agents persisted (solo + team), including `workDir`, `worktreePath`, `worktreeBranch`, `autoMerge`
- Saved on: CREATE_AGENT, FIRE_AGENT, team:phase changes, gateway shutdown
- `loadTeamState()` restores all agents on gateway startup (no filtering)
- Solo agents are NOT removed when creating a team
- Atomic write via tmp file + rename to prevent truncation on kill

### Session Context (`~/.claude/`)
- Agent sessions store agentId → Claude Code session ID mapping
- Actual conversation history lives in `~/.claude/projects/` (managed by Claude Code)
- On restart: `--resume <sessionId>` continues the conversation
- Session IDs should NOT be cleared — causes context loss

### Project History (`~/.open-office[-dev]/data/project-history/`)
- Completed projects archived as `<startedAt>-<name>.json`
- Contains all events, agents, team state, preview info, token usage, ratings
- Event buffer persisted to `project-events.jsonl` (instance-scoped) — survives gateway restarts

## Worktree Events

| Event | When | Payload |
|-------|------|---------|
| `worktree:created` | Worktree created for agent | `agentId`, `taskId`, `worktreePath`, `branch` |
| `worktree:merged` | Merge completed (success or fail) | `agentId`, `branch`, `success`, `commitHash?`, `conflictFiles?`, `stagedFiles?` |
| `worktree:ready` | Worktree has pending unmerged changes (needs manual merge or auto-merge toggle) | `agentId`, `branch` |

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

## External Agent Output
- External agents (detected by process scanner) bypass the orchestrator
- Output read from `~/.claude/projects/` JSONL files by `external-output-reader.ts`
- Text blocks sent as LOG_APPEND events (no truncation, 500ms throttle)
- Frontend accumulates chunks into growing messages (10s window per message block)
- No TASK_DONE event — streaming messages are the final display

## Team Execution Notes
- Leader's non-delegation responses in execute phase are treated as conversational replies (marked `isFinalResult`, phase returns to complete)
- Streaming messages (`-stream` suffix) are cleaned up on: TASK_DONE, TASK_FAILED, TASK_STARTED (stale cleanup), and leader intermediate completions
- Direct fix shortcut: reviewer FAIL → dev (skip leader) → auto re-review → escalate to leader if still failing

## Implementation Status

| Phase | Content | Status |
|-------|---------|--------|
| Phase 1 | Working directory config (workDir, PICK_FOLDER, persistence) | Done |
| Phase 2 | Git worktree isolation (centralized storage, team delegation + solo neighbor/alwaysIsolate) | Done |
| Phase 3 | Conflict detection (git merge-tree dry-run, rebase-then-retry on merge conflict) | Done |
| Phase 4 | Activity Board (agent:activity event, worker team context injection) | Done |
| Phase 5 | Exports/Needs dependency graph + prompt injection | Planned |

## Key File Index

| File | Responsibility |
|------|---------------|
| `packages/shared/src/commands.ts` | Command protocol — `workDir` on CREATE_AGENT/CREATE_TEAM, `PICK_FOLDER`, `UPLOAD_IMAGE` |
| `packages/shared/src/events.ts` | Wire events — `FOLDER_PICKED`, `IMAGE_UPLOADED` |
| `packages/orchestrator/src/types.ts` | Internal events — `AgentActivityEvent`, `WorktreeCreatedEvent`, `WorktreeMergedEvent`, `WorktreeReadyEvent` |
| `packages/orchestrator/src/worktree.ts` | Git worktree CRUD + env isolation — `createWorktree` (centralized path), `mergeWorktree` (squash + rebase-retry), `removeWorktree`, `removeWorktreeOnly`, `checkConflicts` (git 2.38+ with fallback), `cleanupStaleWorktrees` (owner-aware), `getIsolatedGitEnv`, `syncWorktreeToMain`, `undoMergeCommit`, `resetWorktreeToMain`, `revertWorktreeCommit`, `getMergeHistory`, `initGitRepo`, `worktreeHasPendingChanges` |
| `packages/orchestrator/src/delegation.ts` | Team delegation — `DelegationRouter` with `prepareWorktree` callback, batched result forwarding, direct fix shortcut (reviewer→dev→re-review), budget/ceiling enforcement, worker team context |
| `packages/orchestrator/src/orchestrator.ts` | Orchestrator — `prepareWorktree()` (creates worktrees), `hasSoloNeighbor()` detection, `alwaysIsolate` mode, `mergeAllWorktrees()` (team finalization), `detectPendingMerges()`, `undoMerge()`, `setAutoMerge()`, `manualMerge()`, `revertLastCommit()` |
| `packages/orchestrator/src/agent-session.ts` | Agent session — `worktreePath`/`worktreeBranch` storage, `currentWorkingDir` getter (worktree > repoPath > workspace), stale worktree auto-clear, conditional cleanup on failure (preserve on transient API errors) |
| `packages/orchestrator/src/output-parser.ts` | Output parsing — `fullOutput` (no truncation), `summary` fallback |
| `apps/gateway/src/index.ts` | Gateway — `agentWorkDirs` map, `git init` on APPROVE_PLAN, agent persistence, event forwarding (`worktree:created`, `worktree:merged`, `worktree:ready`), `worktreeEnabled` config toggle |
| `apps/gateway/src/external-output-reader.ts` | External agent output — reads JSONL, no text truncation, 500ms throttle |
| `apps/gateway/src/team-state.ts` | State persistence — instance-scoped (`data/instances/<id>/team-state.json`), atomic write (tmp+rename), project history archive with token usage + ratings |
| `apps/web/src/app/office/page.tsx` | UI — console layout, terminal messages, typewriter effect, image support |
| `apps/web/src/store/office-store.ts` | Store — streaming message lifecycle, external agent text accumulation |

## Rejected Approaches

| Approach | Reason |
|----------|--------|
| CRDTs (Yjs/Automerge) | AI agents write entire files, not character-by-character edits — wrong abstraction level |
| Python frameworks (MetaGPT/CrewAI) | Not Node.js native, and they don't solve file conflicts |
| Pure file locking (no worktree) | LLM agents are unpredictable — they may ignore locks and write files directly |
| Custom merge algorithms | Git's three-way merge is already optimal — no need to reinvent the wheel |
| External clash CLI | Native `git merge-tree` achieves the same goal without extra dependencies |
| Clearing session on error | Causes context loss — session should be preserved for retry |
| In-repo `.worktrees/` directory | Path traversal issues — agents walk up to find project root and hit worktree dirs |
| Startup GC for stale worktrees | Could destroy worktrees with pending unmerged changes — replaced by owner-aware cleanup |
