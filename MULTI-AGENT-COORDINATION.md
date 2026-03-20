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

### When Worktrees Are Created

| Scenario | Worktree? | Created By |
|----------|-----------|------------|
| Solo agent, unique workDir | No | — |
| Solo agent, shares workDir with another solo agent | Yes (auto) | `orchestrator.ts` detects neighbor |
| Team dev agent (delegated by leader) | Yes | `delegation.ts` on delegation |
| Team leader | No | — (leaders don't write code) |
| Team reviewer | No | — (reviews on main branch) |

### Team Mode Flow
1. On `APPROVE_PLAN`, gateway creates project dir → `git init` → initial commit
2. Leader delegates tasks → `delegation.ts` creates worktree per dev agent:
   ```bash
   git worktree add .worktrees/<agentId>-<taskId> -b agent/<name>/<taskId>
   ```
3. Each dev agent works in its own worktree (isolated cwd)
4. On task completion: auto-merge back to main via `git merge --no-ff` (wrapped in try/catch — merge failure does NOT block result forwarding to leader)
5. Reviewer reviews on main branch (after merge)
6. Direct fix loop: dev works on main (worktree already merged)

### Solo Multi-Agent Flow
1. First solo agent starts in the workDir directly (occupies main branch)
2. Second solo agent targeting the same workDir → `orchestrator.ts` detects the neighbor via `hasSoloNeighbor()` → auto-creates worktree
3. On completion: merge back to main
4. Requires workDir to be a git repo (otherwise no isolation)

### Native vs Managed Worktrees

| Mode | Mechanism | Status |
|------|-----------|--------|
| **Managed** (`.worktrees/`) | orchestrator creates worktree via `git worktree add`, agent runs in isolated dir | ✅ Active |
| **Native** (`--worktree` flag) | Claude Code's built-in worktree support | ❌ Incompatible with `-p` and `--resume` (exit code 1) |

All backends use **managed worktrees** (`.worktrees/<agentId>-<taskId>`) regardless of native support. The `useNativeWorktree` field on `AgentSession` exists but is always `false`.

### Git Environment Isolation

`worktree.ts` exports `getIsolatedGitEnv()` which clears leaked git env vars (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, etc.) before every git subprocess. This prevents one worktree's commands from accidentally targeting another repo — a subtle bug that caused cross-contamination in early versions.

All agent subprocess spawns (`agent-session.ts`) use this isolated env as the base, then further strip backend-specific vars (`deleteEnv`).

### Merge Strategy: Squash

`mergeWorktree()` uses `git merge --squash` — the agent's work appears as staged changes on main (no merge commit). This enables the reviewer to see a clean diff. On conflict, `git reset --hard HEAD` rolls back and conflict files are reported.

### Worktree Path Priority in CWD Resolution

```
session.worktreePath > repoPath (from RUN_TASK) > session.workspace
```

If `worktreePath` no longer exists on disk (stale state from ungraceful shutdown), the session auto-clears it and falls back. This prevents spawn-failure → 0-output → session-clear cascades.

### Persistence and Restore

- `team-state.ts` persists `worktreePath` and `worktreeBranch` per agent
- On gateway restart, `orchestrator.restoreWorktree()` validates the path exists on disk before restoring — stale paths are silently skipped
- `cleanupStaleWorktrees()` runs on startup: prunes dead metadata, removes orphaned `.worktrees/*` dirs, deletes orphaned `agent/*` branches not attached to any active worktree

### Auto-Cleanup on Failure

When an agent task fails (non-zero exit), `agent-session.ts` auto-removes the orphaned worktree + branch to avoid accumulating dead directories. This runs in a try/catch so cleanup failure never masks the original error.

### Safety: Worktree Operations Never Block Team Flow
- **delegation.ts**: worktree merge in `wireResultForwarding` is wrapped in try/catch — if merge fails, result forwarding to leader continues uninterrupted
- **orchestrator.ts**: worktree handling in `handleSessionEvent` only runs for solo agents (`!session.teamId`), skips team agents entirely (team worktrees are handled by delegation.ts)
- **orchestrator.ts**: worktree operations wrapped in try/catch

## Layer 2: Conflict Detection (Pre-merge Safety)

### Approach
Uses native `git merge-tree --write-tree` for dry-run conflict detection before merging. No external tools required (needs git 2.38+).

### Implementation
Located in `packages/orchestrator/src/worktree.ts`:
```typescript
export function checkConflicts(workspace: string, branch: string): string[] {
  // git merge-tree --write-tree does a dry-run merge
  // Returns list of conflicting file paths, or empty array if clean
  execSync(`git merge-tree --write-tree HEAD "${branch}"`, { cwd: workspace });
}
```

### Trigger Points
- Called automatically in `delegation.ts` after each dev agent completes a task, before merging
- If conflicts detected:
  - Worktree directory removed (branch kept for manual resolution)
  - `worktree:merged` event emitted with `success: false` and `conflictFiles`
- If clean: normal merge proceeds via `mergeWorktree()`

## Layer 3: Activity Board (Real-time Awareness)

### Event Protocol
```typescript
interface AgentActivityEvent {
  type: "agent:activity";
  agentId: string;
  agentName: string;
  intent: string;              // Task description (first 200 chars)
  phase: "started" | "completed";
  touchedFiles?: string[];     // Files being modified
  exports?: string[];          // New interfaces/functions available
  needs?: string[];            // Dependencies needed
}
```

### Current Implementation
- `agent:activity` event emitted on delegation start and task completion in `delegation.ts`
- Events forwarded and logged by gateway

### Planned (Phase 5)
- Inject other agents' activity summaries into current agent's system prompt
- `exports`/`needs` dependency graph for interface contract broadcasting
- File ownership map for soft coordination

## Persistence

### Agent State (`~/.bit-office/team-state.json`)
- All agents persisted (solo + team), including `workDir`
- Saved on: CREATE_AGENT, FIRE_AGENT, team:phase changes, gateway shutdown
- `loadTeamState()` restores all agents on gateway startup (no filtering)
- Solo agents are NOT removed when creating a team

### Session Context (`~/.bit-office/agent-sessions.json` + `~/.claude/`)
- `agent-sessions.json` stores agentId → Claude Code session ID mapping
- Actual conversation history lives in `~/.claude/projects/` (managed by Claude Code)
- On restart: `--resume <sessionId>` continues the conversation
- Session IDs should NOT be cleared — causes context loss

## Console Mode (UI)

Terminal-style chat interface with CRT effects:
- **Layout**: Left vertical tab bar (Agents/Team/External) + top horizontal agent strip + full-height chat
- **Visual**: JetBrains Mono font, green terminal theme (#18ff62), CRT scanlines, screen flicker
- **Messages**: Terminal log format with timestamps and agent name tags `[Marcus]`
- **Input**: Always-visible `>` prompt, ESC to stop working agent, type to continue
- **Streaming**: Real-time output via LOG_APPEND, typewriter reveal effect
- **Completion**: Duration display (e.g. "✱ Brewed for 1m 45s")
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

## Implementation Status

| Phase | Content | Status |
|-------|---------|--------|
| Phase 1 | Working directory config (workDir, PICK_FOLDER, persistence) | Done |
| Phase 2 | Git worktree isolation (team delegation + solo neighbor detection) | Done |
| Phase 3 | Conflict detection (git merge-tree dry-run before merge) | Done |
| Phase 4 | Activity Board (agent:activity event on delegation start/complete) | Done |
| Phase 5 | Exports/Needs dependency graph + prompt injection | Planned |

## Key File Index

| File | Responsibility |
|------|---------------|
| `packages/shared/src/commands.ts` | Command protocol — `workDir` on CREATE_AGENT/CREATE_TEAM, `PICK_FOLDER`, `UPLOAD_IMAGE` |
| `packages/shared/src/events.ts` | Wire events — `FOLDER_PICKED`, `IMAGE_UPLOADED` |
| `packages/orchestrator/src/types.ts` | Internal events — `AgentActivityEvent`, `WorktreeCreatedEvent`, `WorktreeMergedEvent` |
| `packages/orchestrator/src/worktree.ts` | Git worktree CRUD + env isolation — `createWorktree`, `mergeWorktree` (squash), `removeWorktree`, `removeWorktreeOnly`, `checkConflicts`, `cleanupStaleWorktrees`, `getIsolatedGitEnv` |
| `packages/orchestrator/src/delegation.ts` | Team delegation — worktree creation per dev agent, non-blocking merge on completion, activity broadcast |
| `packages/orchestrator/src/orchestrator.ts` | Orchestrator — solo agent neighbor detection, worktree lifecycle (solo only), leader conversational reply handling |
| `packages/orchestrator/src/agent-session.ts` | Agent session — `worktreePath`/`worktreeBranch` storage, `currentWorkingDir` getter, CLI cwd resolution |
| `packages/orchestrator/src/output-parser.ts` | Output parsing — `fullOutput` (no truncation), `summary` fallback |
| `apps/gateway/src/index.ts` | Gateway — `agentWorkDirs` map, `git init` on APPROVE_PLAN, agent persistence, event forwarding |
| `apps/gateway/src/external-output-reader.ts` | External agent output — reads JSONL, no text truncation, 500ms throttle |
| `apps/gateway/src/team-state.ts` | State persistence — all agents (solo + team), no orphan filtering |
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
