# Feature Spec: Memory Visualization Panel

> Author: Nova (PM) | Date: 2026-03-28
> Assignee: **Kai** (Senior Dev)
> Effort: 2 days | Priority: P2 | Parent: Roadmap v2 §4.2

---

## Problem

The memory system (L1 sessions, L2 agent facts, L3 shared knowledge) is invisible to users. They can't see what their agents remember, can't correct wrong facts, and can't understand why an agent behaves a certain way. This creates a "black box" feeling that undermines trust.

## Hypothesis

If users can view and manage agent memory, trust in the system increases and users are more likely to keep agents long-term (reducing fire-and-rehire cycles).

## Success Metric

- **Primary**: Agent lifespan (time from hire to fire) — proxy for trust
- **Guardrail**: Memory panel usage rate > 20% of active users

---

## Scope

### Must Have

1. **Memory panel** (modal or slide-over, accessible from agent card context menu or toolbar):
   - **L1 Session History** tab: Timeline of past task summaries
   - **L2 Agent Facts** tab: List of learned facts with category, reinforcement count, timestamps
   - **L3 Shared Knowledge** tab: Cross-agent facts with source attribution

2. **Per-agent view**: Select an agent to see their L1 + L2 data. L3 is global.

3. **Delete individual facts**: Click ✕ on any L2 fact or L3 knowledge item to remove it
   - Confirm before deletion ("Delete this fact? This cannot be undone.")
   - Sends command to gateway to update the persisted JSON file

4. **Read-only for L1**: Session summaries are historical records — no editing

5. **Search/filter**: Text filter across all facts (simple substring match)

### Won't Have

- Bulk operations (select-all, bulk delete)
- Fact editing (only delete in v1)
- Memory import/export
- Visualization graphs (relationship maps, etc.)
- Creating facts manually

---

## Technical Design

### File Structure

```
apps/web/src/components/office/ui/
  MemoryPanel.tsx               # Main panel with tab navigation
  SessionTimeline.tsx           # L1: Session history list
  AgentFactsList.tsx            # L2: Agent facts with delete
  SharedKnowledgeList.tsx       # L3: Shared knowledge with source
  useMemoryData.ts              # Hook: fetches memory data from gateway
```

### Gateway API (new endpoints needed)

The memory data lives on disk (managed by `packages/memory/src/storage.ts`). The web client needs gateway endpoints to read it:

```typescript
// New commands to add in gateway command handler:

// Read memory
GET_MEMORY_L1   { agentId: string }  → SessionHistoryStore
GET_MEMORY_L2   { agentId: string }  → AgentFactStore
GET_MEMORY_L3   {}                   → SharedKnowledgeStore

// Delete operations
DELETE_FACT_L2  { agentId: string, factId: string }  → { ok: boolean }
DELETE_FACT_L3  { factId: string }                    → { ok: boolean }
```

These should be implemented as **commands** through the existing WebSocket command/response pattern (not HTTP endpoints), consistent with the architecture. The gateway handler calls the storage functions from `packages/memory/src/storage.ts`.

### Data Flow

```
Web Client                          Gateway                     Disk
─────────                          ───────                     ────
sendCommand(GET_MEMORY_L2, {agentId})
  ───────────────────────────→    loadAgentFacts(agentId)
                                    ───────────────────→    agents/{agentId}.json
                                    ←───────────────────    AgentFactStore
  ←───────────────────────────    response: AgentFactStore

sendCommand(DELETE_FACT_L2, {agentId, factId})
  ───────────────────────────→    loadAgentFacts(agentId)
                                  filter out factId
                                  saveAgentFacts(agentId, updated)
                                    ───────────────────→    write agents/{agentId}.json
  ←───────────────────────────    response: { ok: true }
```

### useMemoryData Hook

```typescript
// useMemoryData.ts
interface MemoryData {
  sessions: SessionSummary[];         // L1
  facts: AgentFact[];                 // L2
  shared: SharedKnowledge[];          // L3
  loading: boolean;
  error: string | null;
}

export function useMemoryData(agentId: string | null): MemoryData {
  // On agentId change or panel open:
  //   sendCommand(GET_MEMORY_L1, { agentId })
  //   sendCommand(GET_MEMORY_L2, { agentId })
  //   sendCommand(GET_MEMORY_L3, {})
  // Store results in local state
  // Expose deleteFact(layer, factId) function
}
```

### UI Design

**Memory Panel layout** (terminal aesthetic):

```
┌──────────────────────────────────────────────────────────────┐
│  ▸ AGENT MEMORY: Mia                              [✕]       │
├──────────────────────────────────────────────────────────────┤
│  [Sessions] [Facts] [Shared Knowledge]                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 🔍 Filter facts...                                     │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │                                                        │  │
│  │  FACTS (12)                                           │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐ [✕] │  │
│  │  │ 📋 codebase_pattern                          │     │  │
│  │  │ "User prefers Tailwind over inline styles"   │     │  │
│  │  │ Reinforced 4× │ First: Mar 15 │ Last: Mar 27│     │  │
│  │  └──────────────────────────────────────────────┘     │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐ [✕] │  │
│  │  │ 🎯 user_preference                           │     │  │
│  │  │ "Always use English for git commit messages"  │     │  │
│  │  │ Reinforced 7× │ First: Mar 12 │ Last: Mar 28│     │  │
│  │  └──────────────────────────────────────────────┘     │  │
│  │                                                        │  │
│  │  ... (scrollable)                                     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Tab Details

**Sessions tab (L1)**:
- Reverse chronological list of `SessionSummary`
- Each card shows: `what` (title), `timestamp`, `decisions[]` as bullet list, `filesChanged[]` as tags, `tokens` summary
- Collapsible cards (show title + date, expand for details)
- No delete/edit — read-only historical records

**Facts tab (L2)**:
- List of `AgentFact` items
- Each shows: category badge (colored), fact text, reinforceCount, createdAt, lastSeen
- Category badge colors: `user_preference` → cyan, `codebase_pattern` → green, `workflow_habit` → yellow, `lesson_learned` → purple
- Delete button (✕) on each fact → confirmation dialog → DELETE_FACT_L2 command
- Sort by: reinforceCount (default, descending) or lastSeen (most recent)

**Shared Knowledge tab (L3)**:
- List of `SharedKnowledge` items
- Each shows: fact text, source agent name, confirmedBy[] as agent badges, createdAt
- Delete button with confirmation → DELETE_FACT_L3 command
- This tab is NOT agent-specific (same data regardless of selected agent)

### Entry Point

- **From agent card**: Add "Memory" option to agent context menu (right-click or ⋯ menu) → opens MemoryPanel filtered to that agent
- **From toolbar**: Add "Memory" button next to the Dashboard button → opens with agent selector dropdown

### Agent Selector

- Dropdown at top of panel to switch between agents
- Shows agent name + role
- L1 and L2 tabs refresh on agent change
- L3 tab is unaffected by agent selection

---

## Acceptance Criteria

1. **Given** a user opens the Memory panel for agent "Mia", **when** the Sessions tab is active, **then** they see a reverse-chronological list of Mia's past task summaries with timestamps, decisions, and files changed
2. **Given** agent "Mia" has 5 learned facts, **when** viewing the Facts tab, **then** all 5 facts are shown with category badges, reinforcement counts, and timestamps
3. **Given** a user clicks ✕ on a fact, **when** they confirm deletion, **then** the fact is removed from the list and from the persisted JSON file on disk
4. **Given** shared knowledge exists from multiple agents, **when** viewing the Shared Knowledge tab, **then** each item shows which agent discovered it and which agents confirmed it
5. **Given** a user types "tailwind" in the filter box, **when** filtering is active, **then** only facts/knowledge containing "tailwind" (case-insensitive) are shown
6. **Given** an agent has no memory data, **when** opening their Memory panel, **then** a friendly empty state is shown ("No memories yet — this agent will learn as it works")

---

## Implementation Notes

- **Gateway changes required**: This is the only feature of the three that needs new gateway commands. Add `GET_MEMORY_L1`, `GET_MEMORY_L2`, `GET_MEMORY_L3`, `DELETE_FACT_L2`, `DELETE_FACT_L3` to the command handler. Implementation is straightforward — just call the existing `storage.ts` functions.
- **Command response pattern**: Follow existing gateway command/response pattern. The web client's `sendCommand()` returns a Promise — use this for the data fetching.
- **Reuse types**: Import `SessionSummary`, `AgentFact`, `SharedKnowledge` from `@bit-office/memory` (the shared types package). Make sure these types are accessible to the web client (check if they're already exported from packages/shared or if we need to add them).
- **Performance**: Memory data is small (max 10 sessions × ~200 bytes + max 50 facts × ~100 bytes). No pagination needed.
- **Styling**: Use existing terminal primitives. `TermModal` for the panel, `TermBadge` for categories, `TermButton` for actions.
