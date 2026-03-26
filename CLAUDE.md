# Open Office

## Project Structure
- `apps/web` - Next.js 15 PWA (Vercel deployment)
- `apps/gateway` - Mac daemon (Node.js + multi-channel + AI CLI control)
- `packages/shared` - Shared event protocol (Zod schemas)
- `packages/orchestrator` - Multi-agent engine (worktree, delegation, phases)
- `packages/memory` - Persistent agent memory (sessions, facts, shared knowledge)

## Git
- All git commit messages MUST be in English.

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
- On task:done: auto-merge to main (default), with per-agent toggle + undo merge
- Before each task: auto-rebase onto latest main, conflicts auto-resolved
- Cleanup: on fire agent only (no startup GC)
- Full docs: `packages/orchestrator/README.md` → "Worktree Isolation"

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
