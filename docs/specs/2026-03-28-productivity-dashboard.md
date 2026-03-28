# Feature Spec: Team Productivity Dashboard

> Author: Nova (PM) | Date: 2026-03-28
> Assignee: **Rex** (Senior Dev)
> Effort: 3 days | Priority: P1 | Parent: Roadmap v2 §3.2

---

## Problem

Users can't see long-term value from their AI team. Each session feels isolated — there's no cumulative view of what the team has accomplished over time. This hurts perceived value and contributes to churn.

## Hypothesis

If users can see cumulative team output (projects, files, tokens, activity patterns), perceived value increases and 30-day retention improves.

## Success Metric

- **Primary**: 30-day retention rate (target: measurable via dashboard open rate as proxy)
- **Guardrail**: Dashboard load time < 500ms

---

## Scope

### Must Have

1. **Dashboard panel** (accessible via toolbar button or sidebar tab — NOT a separate route):
   - Total projects completed (all time)
   - Total files changed / lines written (aggregate from project history)
   - Total tokens spent (aggregate from usage data)
   - Total cost (USD, aggregate)

2. **Agent roster with per-agent stats**:
   - Tasks completed count
   - Total tokens used
   - Average task duration
   - Current status badge (idle/working/etc.)

3. **Weekly activity heatmap** (GitHub contribution-graph style):
   - 7 columns (Mon-Sun) × N weeks (up to 12 weeks)
   - Each cell = number of tasks completed that day
   - 5 intensity levels (0, 1, 2, 3, 4+ tasks)
   - Color: green palette matching terminal theme (`--color-success` base)

4. **Data sourced from existing stores** — no new backend API needed for v1:
   - `projectList` from office-store (ProjectSummary[])
   - `agents` Map from office-store (per-agent state)
   - Token usage from agent messages / usage tracking

### Won't Have

- Real-time auto-updating (manual refresh / refresh-on-open is fine)
- Export to CSV/PDF
- Comparison across multiple gateway instances
- Historical trend charts (line graphs) — heatmap is enough for v1
- Separate `/dashboard` route — this is a panel/modal within the existing UI

---

## Technical Design

### File Structure

```
apps/web/src/components/office/ui/
  DashboardPanel.tsx            # Main dashboard layout (modal or slide-over panel)
  DashboardStats.tsx            # Summary stat cards (projects, files, tokens, cost)
  ActivityHeatmap.tsx            # SVG-based contribution graph
  AgentRoster.tsx               # Per-agent stat cards list
  useDashboardData.ts           # Hook: aggregates data from office-store
```

### Data Aggregation Hook

```typescript
// useDashboardData.ts
interface DashboardData {
  // Summary stats
  totalProjects: number;
  totalFilesChanged: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalTokens: { input: number; output: number };
  totalCostUsd: number;

  // Per-agent stats
  agentStats: Array<{
    agentId: string;
    name: string;
    role: string;
    tasksCompleted: number;
    totalTokens: number;
    avgTaskDurationMs: number;
    status: AgentStatus;
  }>;

  // Heatmap data (last 12 weeks)
  heatmapData: Array<{
    date: string;       // ISO date (YYYY-MM-DD)
    count: number;      // tasks completed
    intensity: 0 | 1 | 2 | 3 | 4; // mapped from count
  }>;
}

export function useDashboardData(): DashboardData {
  const projectList = useOfficeStore(s => s.projectList);
  const agents = useOfficeStore(s => s.agents);
  // ... aggregate and return
}
```

### Data Sources (what's already available)

From `office-store.ts`:
- **`projectList: ProjectSummary[]`** — each has: `startedAt`, `endedAt`, `agentNames[]`, `eventCount`, `tokenUsage?: { input, output, cost }`, `ratings?`
- **`agents: Map<string, AgentState>`** — each has: `status`, `tokenUsage: { input, output }`, `messages: ChatMessage[]`
- **`teamMessages: TeamChatMessage[]`** — inter-agent events with timestamps

Aggregation logic:
- `totalProjects` = `projectList.length`
- `totalTokens` = sum of all `projectList[].tokenUsage` + current agent tokens
- `totalCostUsd` = derive from token counts using model pricing (reuse UsagePanel's `fmtCost` logic)
- `heatmapData` = group `projectList` by `endedAt` date, count per day
- `agentStats` = iterate agents Map, count messages with `role === "assistant"` and `isFinalResult === true` for tasks completed
- Files/lines: parse from ProjectSummary if available, or count from TASK_DONE events

### UI Design

**Dashboard layout** (terminal aesthetic):

```
┌─────────────────────────────────────────────────────────────┐
│  ▸ TEAM DASHBOARD                                    [✕]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ PROJECTS │ │  FILES   │ │  TOKENS  │ │   COST   │      │
│  │    12    │ │   248    │ │   1.2M   │ │  $4.32   │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ACTIVITY (last 12 weeks)                                   │
│  Mon ░░▓░░░░░▓▓░░                                          │
│  Tue ░▓░░░▓░░░░▓░                                          │
│  Wed ░░░▓▓░░░▓░░░                                          │
│  Thu ▓░░░░░▓░░▓░░                                          │
│  Fri ░░▓░░░░▓░░░░                                          │
│  Sat ░░░░░░░░░░░░                                          │
│  Sun ░░░░░░░░░░░░                                          │
│                                                             │
│  AGENT ROSTER                                               │
│  ┌─────────────────────────────────────────────────┐       │
│  │ Mia (Developer)    │ 8 tasks │ 450K tokens │ ● │       │
│  │ Leo (Reviewer)     │ 6 tasks │ 120K tokens │ ○ │       │
│  │ Rex (Developer)    │ 4 tasks │ 380K tokens │ ● │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Details

**DashboardStats.tsx** — 4 stat cards in a row:
- Use `TermBadge` or custom stat card with label + large number
- Numbers use `fmtTokens()` for token counts, `fmtCost()` for USD
- Cards are non-interactive (display only)

**ActivityHeatmap.tsx** — Pure SVG:
- Cell size: 12×12px, gap: 2px
- 5 colors: `transparent` (0), `#0e4429` (1), `#006d32` (2), `#26a641` (3), `#39d353` (4+)
- Tooltip on hover: "3 tasks on Mar 15" (use title attribute, no tooltip library)
- Week labels on top, day labels on left
- Total width: ~170px (12 weeks × 14px)

**AgentRoster.tsx** — List of agent cards:
- Each row: name, role badge, tasks count, tokens, status dot
- Sort by tasks completed (descending)
- Status dot: green (idle), blue (working), yellow (waiting), red (error)
- Clicking an agent row could scroll to their pane (nice-to-have)

### Entry Point

- Add a "Dashboard" button in the toolbar area (EditorToolbar or similar top-level UI)
- Uses `TermModal` (existing) to render as a modal overlay
- Dashboard state: `showDashboard: boolean` in office-store or local component state

---

## Acceptance Criteria

1. **Given** a user clicks the Dashboard button, **when** the dashboard opens, **then** summary stats (projects, files, tokens, cost) are displayed with correct aggregated values
2. **Given** a user has completed projects over multiple weeks, **when** viewing the heatmap, **then** cells are colored by activity intensity with correct day mapping
3. **Given** multiple agents exist, **when** viewing the agent roster, **then** each agent shows task count, token usage, and current status
4. **Given** no projects have been completed, **when** opening the dashboard, **then** stats show 0 and heatmap is empty (not an error state)
5. **Given** the dashboard is open, **when** the user closes it, **then** the underlying UI is fully responsive again (no z-index issues)

---

## Implementation Notes

- **No new gateway API needed** — all data comes from the client-side Zustand store (projectList, agents Map). The data is already persisted in localStorage via office-store's hydrate/save cycle.
- **Performance**: `useDashboardData` should use `useMemo` with appropriate deps to avoid re-aggregation on every render. The heatmap SVG is static once computed.
- Reuse existing UI primitives: `TermModal`, `TermBadge`, `TermButton` from `ui/primitives/`.
- Follow the terminal/console aesthetic from `global.css` (monospace numbers, dark bg, colored accents).
