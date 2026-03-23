# Open Office

## Project Structure
- `apps/web` - Next.js 15 PWA (Vercel deployment)
- `apps/gateway` - Mac daemon (Node.js + multi-channel + AI CLI control)
- `packages/shared` - Shared event protocol (Zod schemas)
- `packages/orchestrator` - Multi-agent engine (worktree, delegation, phases)
- `packages/memory` - Persistent agent memory (sessions, facts, shared knowledge)

## Key Commands
- `pnpm dev:web` - Start web dev server
- `pnpm dev:gateway` - Start gateway

## Architecture
- **Channels**: WebSocket (always), Ably (optional), Telegram (optional)
- **UI**: PixiJS v8 pixel office + Key Node Mode agent cards

## Data Directory
- Dev: `~/.open-office-dev/`, Release: `~/.open-office/`
- `config.json` — global config
- `data/instances/<id>/` — per-gateway state (logs, sessions, memory)
- `data/agents.json` — agent definitions
- `projects/` — default agent workspace (team projects created here)
- `worktrees/<repo-hash>/<agentId>/` — centralized worktree isolation

## Worktree Isolation
- One agent = one worktree = one branch (keyed by agentId, not taskId)
- Worktrees stored outside repo at `~/.open-office[-dev]/worktrees/` to prevent path traversal
- Cleanup: on fire agent only (no startup GC — worktrees carry unmerged state)

## Merge Control (per-agent)
- **autoMerge** (default: off): per-agent toggle in UI chat area
- **Off (deferred merge)**: task:done → auto-commit to agent branch → set `pendingMerge=true` → UI shows merge/revert buttons
- **On (auto-merge)**: task:done → squash-merge to main immediately (legacy behavior)
- **Before each task**: `syncWorktreeToMain()` rebases agent branch onto latest main (skipped if pendingMerge=true to avoid losing unmerged work). Conflicts auto-resolved with main priority (`-X theirs`) since agent hasn't started new work yet.
- **Merge conflicts**: clean rebase attempted first; if conflicts, auto-resolved with agent priority (`-X ours` — agent's changes preserved). Dirty files on main are stashed/restored around all merge and undo operations.

### UI Controls (chat input area, both sidebar and console mode)
- **merge to main** (green): squash-merge agent branch → main, records commitHash
- **revert** (yellow): `git reset --hard HEAD~1` on agent branch (pre-merge, undo last agent commit)
- **undo merge** (red): `git revert <commitHash>` on main (post-merge, one-level undo)
- **auto-merge** checkbox: toggle per-agent autoMerge preference
- All buttons disabled while agent is working

### Commands & Events
- Commands: `MERGE_WORKTREE`, `REVERT_WORKTREE`, `UNDO_MERGE`, `TOGGLE_AUTO_MERGE`
- Events: `WORKTREE_READY`, `WORKTREE_MERGED` (with commitHash), `WORKTREE_REVERTED`, `AUTO_MERGE_UPDATED`
- State: `autoMerge` persisted in team-state.json; `pendingMerge` reconstructed on restart via `detectPendingMerges()`; `lastMergeCommit` is runtime-only (lost on restart)

### Agent branches
- Branches are local only (not pushed to remote)
- Visible in SourceTree/git tools (click commit in graph, don't checkout — checkout fails because worktree holds the branch)
- To browse agent files: `cd ~/.open-office[-dev]/worktrees/<repo-hash>/<agentId>/`

## Key Node Mode
Only 4 key events shown in UI: TASK_STARTED, APPROVAL_NEEDED, TASK_DONE, TASK_FAILED.
Agent states: idle, working, waiting_approval, done, error.
TASK_DONE includes structured result (changedFiles, diffStat, testResult).

## Team Execution Flow
Phases: CREATE → DESIGN → EXECUTE → COMPLETE → (loop or END).
Execute: Leader → Dev (build+self-fix) → Reviewer (VERDICT) → Fix loop (max 3 reviews).
Roles: Developer (ENTRY_FILE or PREVIEW_CMD+PORT), Code Reviewer (VERDICT PASS/FAIL), Team Lead (delegates only).
Preview: static HTML (npx serve:9100), build output (dist/index.html), or command (PREVIEW_CMD on PREVIEW_PORT).
Project dir: unique per session, all members share it. Created on APPROVE_PLAN.
