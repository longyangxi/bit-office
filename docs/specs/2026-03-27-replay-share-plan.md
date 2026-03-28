# Replay Share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the share module from a static GIF recap into an interactive timeline replay — letting viewers watch an AI team's work session unfold with key moments (task start, discussions, code changes, product preview screenshots, review verdict, completion) and auto-pausing on the most impactful moments.

**Architecture:** Orchestrator auto-captures screenshots on PREVIEW_READY and TASK_DONE. Gateway stores screenshots in session data and exposes a Replay API (`GET /api/replay/:projectId`). Frontend renders a TimelinePlayer component on a standalone `/replay/:id` route. Live Preview is explicitly out of scope — preview is screenshot-only with optional static file download.

**Tech Stack:** TypeScript, packages/orchestrator (screenshot capture), packages/shared (types), apps/gateway (API), apps/web (Next.js route + Vanilla JS Canvas for timeline)

---

## File Map

| Task | Action | File | What |
|------|--------|------|------|
| 1 | Modify | `packages/shared/src/events.ts` | Add `PREVIEW_SCREENSHOT` event schema to GatewayEvent union |
| 2 | Create | `packages/orchestrator/src/screenshot-capture.ts` | Auto-screenshot on PREVIEW_READY / TASK_DONE via Puppeteer |
| 2 | Create | `packages/orchestrator/src/__tests__/screenshot-capture.test.ts` | Unit tests |
| 3 | Modify | `apps/gateway/src/index.ts` | Store PREVIEW_SCREENSHOT events in project archive |
| 3 | Modify | `apps/gateway/src/ws-server.ts` | Include screenshot events in PROJECT_DATA response |
| 4 | Create | `packages/shared/src/replay-types.ts` | ReplayMoment, ReplayPackage, PreviewData types |
| 5 | Modify | `apps/gateway/src/ws-server.ts` | Add `GET /api/replay/:projectId` endpoint |
| 5 | Create | `apps/gateway/src/replay-builder.ts` | Transform raw project events → ReplayPackage |
| 6 | Create | `apps/web/src/components/share/TimelinePlayer.tsx` | Timeline player with moment rendering |
| 6 | Create | `apps/web/src/components/share/PreviewMomentCard.tsx` | Screenshot carousel + optional download button |
| 7 | Create | `apps/web/src/app/replay/[id]/page.tsx` | Standalone `/replay/:id` Next.js route |
| 8 | Modify | `apps/web/src/components/office/ui/ProjectHistory.tsx` | Add "Share Replay" button per project |

---

## Task 1: Add PREVIEW_SCREENSHOT Event Schema

**Files:**
- Modify: `packages/shared/src/events.ts`

**Steps:**
- [ ] Add `PreviewScreenshotEvent` Zod schema:
  ```typescript
  const PreviewScreenshotEvent = z.object({
    type: z.literal("PREVIEW_SCREENSHOT"),
    agentId: z.string(),
    taskId: z.string(),
    imageData: z.string(),           // base64 PNG
    timestamp: z.number(),
    trigger: z.enum(["preview_ready", "task_done"]),
  });
  ```
- [ ] Add `PREVIEW_SCREENSHOT` to the `GatewayEvent` discriminated union
- [ ] Export the type: `export type PreviewScreenshotEvent = z.infer<typeof PreviewScreenshotEvent>`
- [ ] Verify: `pnpm -F shared build` compiles without errors

**Acceptance:** Schema compiles, other packages can import `PreviewScreenshotEvent`.

---

## Task 2: Orchestrator Auto-Screenshot

**Files:**
- Create: `packages/orchestrator/src/screenshot-capture.ts`
- Create: `packages/orchestrator/src/__tests__/screenshot-capture.test.ts`

**Steps:**
- [ ] Create `ScreenshotCapture` class with:
  - `capture(url: string, options?: { timeout?: number }): Promise<string | null>` — returns base64 PNG or null on failure
  - Uses Puppeteer (headless) to navigate to `url`, wait for load, capture 800×600 viewport
  - Timeout: 10 seconds (configurable), returns null on timeout/error — **never throws**
- [ ] Create `onPreviewReady(event: PreviewReadyEvent, context: { agentId, taskId }): Promise<PreviewScreenshotEvent | null>` helper
  - Calls `capture(event.url)`, wraps result in `PREVIEW_SCREENSHOT` event with `trigger: "preview_ready"`
- [ ] Create `onTaskDone(event: TaskDoneEvent): Promise<PreviewScreenshotEvent | null>` helper
  - Only captures if `result.previewUrl` or `result.entryFile` (as file:// URL) exists
  - `trigger: "task_done"`
- [ ] Wire into orchestrator event pipeline: after PREVIEW_READY → call `onPreviewReady`, emit screenshot event; after TASK_DONE → call `onTaskDone`, emit screenshot event
- [ ] Write unit tests:
  - Mock Puppeteer: successful capture returns base64
  - Mock Puppeteer: timeout returns null (no throw)
  - onTaskDone with no preview data → returns null (no capture attempted)
- [ ] Save screenshots to disk: `data/instances/<instanceId>/screenshots/<taskId>-<trigger>.png`

**Acceptance:** Run a task with preview → `screenshots/` dir contains PNG files + PREVIEW_SCREENSHOT events emitted.

**Guardrail:** Screenshot failure MUST NOT block the main orchestration flow. All capture calls are wrapped in try/catch returning null.

---

## Task 3: Store Screenshots in Project Archive

**Files:**
- Modify: `apps/gateway/src/index.ts`
- Modify: `apps/gateway/src/ws-server.ts`

**Steps:**
- [ ] In the gateway event handler, persist `PREVIEW_SCREENSHOT` events into the project's event log (same storage as TEAM_CHAT, TASK_DONE, etc.)
- [ ] When building `PROJECT_DATA` response, include `PREVIEW_SCREENSHOT` events in the event array
- [ ] Add `screenshotCount: number` to `ProjectSummary` (used in PROJECT_LIST)
- [ ] Verify: after a session with screenshots, `PROJECT_DATA` response contains screenshot events with base64 data

**Acceptance:** `PROJECT_DATA` API returns complete event history including screenshots.

---

## Task 4: Replay Data Types

**Files:**
- Create: `packages/shared/src/replay-types.ts`

**Steps:**
- [ ] Define and export:
  ```typescript
  export type MomentType = 'start' | 'chat' | 'code' | 'preview' | 'review' | 'done';

  export interface ReplayMoment {
    type: MomentType;
    timestamp: number;
    agentId: string;
    agentName?: string;
    autoPause: boolean;          // true for 'preview' and 'done'
    data: MomentData;
  }

  export type MomentData =
    | StartMomentData
    | ChatMomentData
    | CodeMomentData
    | PreviewMomentData
    | ReviewMomentData
    | DoneMomentData;

  export interface StartMomentData {
    taskDescription: string;
    assignedTo: string;
  }

  export interface ChatMomentData {
    speaker: string;
    message: string;
  }

  export interface CodeMomentData {
    changedFiles: string[];
    diffStat: { added: number; removed: number };
    diffPreview?: string;        // first 50 lines of unified diff
  }

  export interface PreviewMomentData {
    screenshots: string[];       // base64 or URL paths
    caption?: string;
    downloadable?: {
      type: 'static-html';
      zipUrl: string;            // GET endpoint for zip download
      entryFile: string;         // path inside zip
    };
  }

  export interface ReviewMomentData {
    reviewer: string;
    verdict: 'pass' | 'fail';
    summary?: string;
  }

  export interface DoneMomentData {
    summary: string;
    changedFiles: string[];
    diffStat: { added: number; removed: number };
    testResult?: { pass: number; fail: number };
    duration: number;
    tokenUsage?: { input: number; output: number };
  }

  export interface ReplayPackage {
    projectId: string;
    projectName: string;
    duration: number;            // ms
    agents: Array<{ id: string; name: string; role: string; avatar?: string }>;
    moments: ReplayMoment[];
    stats: {
      totalFiles: number;
      totalAdded: number;
      totalRemoved: number;
      totalTokens: number;
      reviewRounds: number;
    };
  }
  ```
- [ ] Export from `packages/shared/src/index.ts`
- [ ] Verify: `pnpm -F shared build` compiles

**Acceptance:** Types importable from `@open-office/shared`.

---

## Task 5: Replay API Endpoint + Builder

**Files:**
- Modify: `apps/gateway/src/ws-server.ts`
- Create: `apps/gateway/src/replay-builder.ts`

**Steps:**
- [ ] Create `replay-builder.ts` with `buildReplayPackage(projectData: ProjectArchive): ReplayPackage`:
  - Extract moments from raw events using these rules:
    - `TASK_STARTED` → `start` moment
    - `TEAM_CHAT` (with `isHighlight` flag or from team lead) → `chat` moment
    - Batched file changes (group consecutive file events within 30s) → `code` moment
    - `PREVIEW_SCREENSHOT` → `preview` moment (aggregate screenshots per taskId, set `autoPause: true`)
    - `TASK_DONE` with verdict-related content from reviewer → `review` moment
    - `TASK_DONE` with `isFinalResult: true` → `done` moment (set `autoPause: true`)
  - Sort moments by timestamp
  - Compute aggregate stats from all events
  - Limit chat moments: max 10 per project (pick most relevant by length/role)
- [ ] Write unit tests for `buildReplayPackage`:
  - Empty project → empty moments, valid structure
  - Project with all event types → correct moment ordering
  - Multiple screenshots → grouped into single preview moment per task
- [ ] Add REST endpoint `GET /api/replay/:projectId`:
  - Load project archive by ID
  - Call `buildReplayPackage()`
  - Return JSON response
  - 404 if project not found
- [ ] Add CORS headers for the replay endpoint (replay page may be shared externally)

**Acceptance:** `curl http://localhost:<port>/api/replay/<id>` returns valid `ReplayPackage` JSON.

---

## Task 6: Timeline Player + Preview Card Components

**Files:**
- Create: `apps/web/src/components/share/TimelinePlayer.tsx`
- Create: `apps/web/src/components/share/PreviewMomentCard.tsx`

**Steps:**
- [ ] **TimelinePlayer** component:
  - Props: `{ replay: ReplayPackage }`
  - Timeline bar: horizontal track with dots per moment, color-coded by type
    - 🔵 start, 💬 chat, 🟢 code, 👁️ preview (yellow), ✅ review, 🎉 done (gold)
  - Auto-play: advance to next moment every 3 seconds (configurable)
  - Auto-pause: when `moment.autoPause === true`, stop and show "▶ Continue" button
  - Manual navigation: click any dot to jump, or use ← → arrows
  - Speed control: 1x / 2x / 4x toggle
  - Current moment display area: renders appropriate card based on `moment.type`
  - Progress indicator: "Moment 3 of 12" + elapsed/total time
  - Moment cards:
    - `start`: task description + assigned agent avatar
    - `chat`: chat bubble with speaker name
    - `code`: file list + diff stat bar (green/red) + optional diff preview
    - `preview`: delegate to PreviewMomentCard
    - `review`: verdict badge (PASS green / FAIL red) + reviewer name + summary
    - `done`: summary + stats grid (files, tokens, duration, tests)
- [ ] **PreviewMomentCard** component:
  - Screenshot carousel: display current screenshot, left/right arrows, dot indicators
  - Caption text below screenshots
  - "📦 Download Product" button (only visible when `downloadable` exists)
  - Download triggers `window.open(downloadable.zipUrl)`
- [ ] Responsive: works on desktop (800px+) and mobile (360px+)
- [ ] Keyboard: Space = play/pause, ← → = prev/next, 1/2/4 = speed

**Acceptance:** Renders correctly with mock `ReplayPackage` data. All moment types display. Auto-pause works on preview and done moments.

---

## Task 7: Standalone Replay Route

**Files:**
- Create: `apps/web/src/app/replay/[id]/page.tsx`

**Steps:**
- [ ] Create Next.js dynamic route `/replay/[id]`
- [ ] On mount: fetch `GET /api/replay/:id` from gateway
- [ ] States:
  - Loading: skeleton/spinner
  - Error: "Replay not found" with back link
  - Ready: render `<TimelinePlayer replay={data} />`
- [ ] Page metadata: `<title>{projectName} - Open Office Replay</title>`
- [ ] No WebSocket connection needed (pure static data fetch)
- [ ] Gateway URL: read from environment or use same-origin `/api/replay/:id` via Next.js API proxy
- [ ] Mobile-friendly viewport meta

**Acceptance:** Navigate to `/replay/<valid-id>` → see full timeline replay. Navigate to `/replay/invalid` → see error state.

---

## Task 8: Share Replay Integration

**Files:**
- Modify: `apps/web/src/components/office/ui/ProjectHistory.tsx`

**Steps:**
- [ ] Add "🔗 Share Replay" button next to each project in the history list
- [ ] On click: construct URL `${window.location.origin}/replay/${project.id}`, copy to clipboard
- [ ] Show toast: "Replay link copied!"
- [ ] Keep existing ProjectRecap GIF as a separate "Share GIF" option (don't remove)
- [ ] Visual: replay button is primary (more prominent), GIF button is secondary

**Acceptance:** Click "Share Replay" → URL copied → paste in new tab → replay loads.

---

## Execution Order & Dependencies

```
Task 1 (schema)          ─── no deps ──────────────────── ~0.5 day
Task 4 (replay types)    ─── no deps ──────────────────── ~0.5 day
  ↕ can run in parallel
Task 2 (screenshot)      ─── depends on: Task 1 ───────── ~1.5 days
Task 3 (archive storage) ─── depends on: Task 1 ───────── ~0.5 day
Task 5 (replay API)      ─── depends on: Task 3, 4 ────── ~1 day
Task 6 (timeline player) ─── depends on: Task 4 ───────── ~2 days
Task 7 (replay route)    ─── depends on: Task 5, 6 ────── ~0.5 day
Task 8 (integration)     ─── depends on: Task 7 ───────── ~0.5 day
                                              Total: ~7 days
```

**MVP (4 days):** Tasks 1 + 2 + 3 + 4 + 5 + 6 + 7 — full replay with screenshots, standalone route.
Skip Task 8 (integration) and `downloadable` in Task 6 for MVP.

**Parallel opportunities:**
- Task 1 + Task 4 can run simultaneously (day 1)
- Task 2 + Task 3 can run simultaneously (day 2)
- Task 5 + Task 6 can run simultaneously (day 3-4)

---

## Out of Scope (Explicitly Deferred)

| Item | Reason | Revisit When |
|------|--------|-------------|
| Remotion video export | Non-core, heavy dependency | After replay v1 validated |
| Live Preview (iframe) | Runtime dependency, security, not shareable | Hosted preview infra exists |
| External sharing auth | Current replay is public by URL | Usage patterns indicate abuse risk |
| Replay editing (trim/reorder) | Complexity, unclear demand | User feedback requests it |

---

## Success Metrics

- **Primary:** Shared replay link completion rate > 40% (viewer reaches `done` moment)
- **Guardrail:** Screenshot auto-capture success rate > 95% (must never block orchestration)
- **Guardrail:** Replay API response time < 2s for projects with ≤ 100 events
