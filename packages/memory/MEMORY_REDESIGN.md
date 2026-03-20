# Open Office Memory Redesign

> **Author**: Alex 3 | **Date**: 2026-03-18
> **Status**: Implemented and in active use — `packages/memory/`
> **Inspired by**: [Mem0](https://github.com/mem0ai/mem0) (fact extraction + dedup), [OpenViking](https://github.com/volcengine/OpenViking) (L0/L1/L2 layered loading)
> **Package**: `@bit-office/memory` — implemented in `packages/memory/src/` with dedicated unit test coverage in `src/__tests__/`

---

## 1. Problem Statement

### Current System Analysis

Open Office currently has **two disconnected memory mechanisms**:

#### A. Recovery Context (`agent-session.ts`)
```typescript
// What we save on task success:
interface RecoveryContext {
  originalTask?: string;       // truncated to 300 chars
  phase?: string;
  lastResult?: string;         // truncated to 200 chars
  recentMessages?: Array<{     // last 6 messages, each 400 chars max
    role: "user" | "assistant";
    text: string;
  }>;
}
```

**Problems:**
- `recentMessages` is a raw sliding window (last 6 turns), not semantically meaningful
- 400-char truncation cuts mid-sentence, loses key information
- No structured facts — just raw conversation fragments
- After session loss, agent gets fragments like "Let me verify the build compiles" — useless without context
- Real example: Alex 2 recovered with 2 messages, couldn't remember **what** was built or **why**

#### B. Long-term Memory (`memory.ts`)
```typescript
interface MemoryStore {
  reviewPatterns: ReviewPattern[];  // from reviewer FAIL verdicts
  techPreferences: string[];        // from approved plan TECH lines
  projectHistory: ProjectRecord[];  // summary + ratings
}
```

**Problems:**
- Only captures structured data from team workflow events (review, plan approval, completion)
- No agent-level learning (e.g. "user prefers dashed borders" or "this codebase uses TERM_HOVER theme tokens")
- No cross-agent knowledge sharing
- No session-level work summaries (what was done, what decisions were made)

#### C. Claude's Own Memory (`MEMORY.md`)
```markdown
# Memory Index
- [feedback_edit_visibility.md](feedback_edit_visibility.md) — After code edits, explicitly state what changed
```

**Problems:**
- Only accessible to Claude Code itself, not to our orchestrator
- Can't be structured, queried, or shared across agents
- No deduplication — entries accumulate without cleanup

### The Gap

```
What we HAVE:                    What we NEED:
┌──────────────┐                ┌──────────────────────────┐
│ Raw messages │                │ Structured work summary  │
│ (6 x 400ch) │                │ (what/why/files/decisions)│
├──────────────┤                ├──────────────────────────┤
│ Project-level│                │ Session-level learning   │
│ history only │                │ (per-task facts)         │
├──────────────┤                ├──────────────────────────┤
│ Single agent │                │ Cross-agent context      │
│ context only │                │ (L0 summaries)           │
└──────────────┘                └──────────────────────────┘
```

---

## 2. Design Goals

| # | Goal | Metric |
|---|------|--------|
| G1 | Agent recovers with **actionable context** after session loss | Recovery prompt contains structured facts, not raw fragments |
| G2 | Cross-agent awareness without token explosion | Other agents get 1-2 line L0 summary (~50 tokens), not full chat history |
| G3 | Accumulate **agent-level** learning (not just project-level) | Facts like "user prefers solid borders" persist across sessions |
| G4 | Zero external dependencies | No vector DB, no external LLM calls, no new services |
| G5 | Backward compatible | Existing `memory.ts` and `RecoveryContext` continue to work |
| G6 | Minimal token cost | Fact extraction is rule-based at session end, with no extra model call |
| G7 | Crash-safe recovery | Persist in-progress work state so interrupted sessions recover with actionable context |

---

## 3. Architecture

### 3.1 Four-Layer Memory Model

Inspired by Mem0's tiered memory + OpenViking's L0/L1/L2 loading:

```
┌─────────────────────────────────────────────────────────────┐
│                    Open Office Memory                        │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│   Layer 0   │   Layer 1    │   Layer 2    │    Layer 3      │
│  EPHEMERAL  │   SESSION    │    AGENT     │    SHARED       │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ Current     │ Per-task     │ Per-agent    │ Cross-agent     │
│ conversation│ structured   │ long-term    │ project-wide    │
│ sliding     │ summary      │ facts &      │ knowledge       │
│ window      │ + facts      │ preferences  │                 │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ In-memory   │ JSON file    │ JSON file    │ JSON file       │
│ (volatile)  │ (persisted)  │ (persisted)  │ (persisted)     │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ ~6 turns    │ Last 30      │ Up to 50     │ Up to 20        │
│ (~2400 tok) │ sessions     │ facts/agent  │ facts total     │
│             │ (~200 tok ea)│ (~1000 tok)  │ (~500 tok)      │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ NOW         │ IMPROVE      │ NEW          │ NEW             │
│ (keep as-is)│ (upgrade)    │              │                 │
└─────────────┴──────────────┴──────────────┴─────────────────┘
```

### 3.2 Data Flow

```
                    Agent running task...
                           │
                           ▼
                ┌─────────────────────┐
                │  L0: conversationLog │ ← sliding window (existing)
                │  (raw messages, 6)   │
                └──────────┬──────────┘
                           │ periodic progress snapshots
                           ▼
               ┌───────────────────────┐
               │  Work State Snapshot  │ ← persisted while task runs
               │  (summary/next/files) │
               └──────────┬───────────┘
                          │ task completes / interrupts
                          ▼
               ┌───────────────────────┐
               │  Fact Extraction      │ ← extract structured data
               │  (parse agent output) │   from stdoutBuffer, no LLM needed
               └──────────┬───────────┘
                          │
              ┌───────────┼───────────────┐
              ▼           ▼               ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────┐
    │ L1: Session  │ │ L2: Agent│ │ L3: Shared   │
    │ Summary      │ │ Facts    │ │ Knowledge    │
    │ (what/why/   │ │ (prefs,  │ │ (project     │
    │  files/next) │ │  patterns│ │  conventions)│
    └──────────────┘ │  learned)│ └──────────────┘
                     └──────────┘
```

### 3.3 Storage Layout

```
~/.bit-office/memory/
├── memory.json              # Legacy project-level memory
├── sessions/
│   └── {agentId}.json       # L1: latest + 30-item history ring buffer
├── agents/
│   └── {agentId}.json       # L2: per-agent learned facts
├── work-state/
│   └── {agentId}.json       # Crash-safe in-progress snapshot
└── shared.json              # L3: cross-agent project knowledge
```

---

## 4. Detailed Design

### 4.1 Layer 1 — Session Summary (replaces raw `recentMessages`)

#### Schema

```typescript
interface SessionSummary {
  /** ISO timestamp */
  timestamp: string;

  /** One-line description: "Optimized MultiPaneView pagination UI" */
  what: string;

  /** Key decisions made during this session */
  decisions: string[];

  /** Files created or modified */
  filesChanged: string[];

  /** Unfinished work or known issues */
  unfinished: string[];

  /** Git commits created */
  commits: string[];

  /** Token usage for this session */
  tokens: { input: number; output: number };
}
```

#### How it's generated

**No LLM call needed.** We already have all the data in `AgentSession`:

| Field | Source |
|-------|--------|
| `what` | `extractResult().summary` or `SUMMARY:` line from stdout |
| `filesChanged` | `taskChangedFiles` Set — already tracked from tool_use events |
| `commits` | Parse from stdoutBuffer: lines matching `Committed \`[a-f0-9]+\`` |
| `unfinished` | Parse from output: lines after "TODO" / "unfinished" / "remaining" |
| `decisions` | Parse from output: lines with "changed from X to Y" / "chose X over Y" / "because" |
| `tokens` | `taskInputTokens` / `taskOutputTokens` — already tracked |

In the shipped implementation, file paths are shortened to the last 3 path segments to keep recovery prompts compact.

### 4.1.1 Live Work State (implemented)

The final implementation adds a persisted `WorkState` snapshot alongside session summaries so recovery still works when a task is interrupted before `commitSession()` runs.

```typescript
interface WorkState {
  startedAt: string;
  updatedAt: string;
  status: "running" | "interrupted" | "failed" | "cancelled";
  taskId?: string;
  taskPrompt?: string;
  cwd?: string;
  summary: string;
  nextSteps: string[];
  unfinished: string[];
  filesTouched: string[];
  lastActivity?: string;
}
```

Current behavior:
- `updateWorkState()` persists snapshots during execution
- `buildRecoveryContext()` prefers `workState` over the last completed `sessionSummary`
- `clearAgentWorkState()` clears the snapshot after clean completion

#### Recovery injection format

**Before** (current — raw fragments):
```
[Session recovered] Your previous session was lost. Here's what you were doing:
- Last result: There are changes in two files, but the `agent-session.ts` changes are from a different task
- Recent conversation:
  [You]: Let me verify the build compiles:
  [You]: Those errors are pre-existing `@types/node` version conflicts, not from my changes.
```

**After** (new — structured summary):
```
[Session recovered] Your previous session was lost. Here's what you were doing:
- Task: Optimize MultiPaneView pagination UI
- What you did: Redesigned pagination arrows as styled buttons, changed borders from dashed to solid, added hover scale animation
- Files changed: apps/web/src/components/MultiPaneView.tsx
- Commits: ad8ed51
- Decisions: Used TERM_HOVER/TERM_BORDER theme tokens instead of hardcoded rgba values
- Unfinished: agent-session.ts changes remain unstaged (separate task)
Note: You don't have full conversation history. Ask the user if unsure about details.
```

Token comparison: **~400 tokens (before) → ~150 tokens (after), 2.5x more informative**

### 4.2 Layer 2 — Agent Facts (NEW)

Long-lived facts about a specific agent's working context. Think of these as things an agent would "remember" about its user and codebase.

#### Schema

```typescript
interface AgentFact {
  /** Unique ID for dedup */
  id: string;

  /** Category for grouping */
  category: "user_preference" | "codebase_pattern" | "workflow_habit" | "lesson_learned";

  /** The fact itself: "User prefers solid borders over dashed" */
  fact: string;

  /** How many sessions this fact has been relevant */
  reinforceCount: number;

  /** When first observed */
  createdAt: string;

  /** When last reinforced */
  lastSeen: string;
}
```

#### How facts are extracted

**Implemented now (v1 — rule-based, no LLM):**

Parse agent output for patterns:

```typescript
const FACT_PATTERNS: Array<{ regex: RegExp; category: AgentFact["category"] }> = [
  // User preferences
  { regex: /(?:user|you)\s+(?:prefer|like|want|asked for)\s+(.{10,80})/i, category: "user_preference" },

  // Codebase patterns
  { regex: /(?:this|the)\s+(?:codebase|project|repo)\s+(?:uses?|has)\s+(.{10,80})/i, category: "codebase_pattern" },

  // Lessons learned
  { regex: /(?:note|important|remember|caution):\s*(.{10,80})/i, category: "lesson_learned" },
];
```

The shipped regex set also covers:
- theme/token conventions such as `TERM_*`
- workflow rules like "always/never/make sure to ... before committing"
- pre-existing errors and known issues

#### Dedup strategy (borrowed from Mem0)

Before adding a fact, check existing facts:

```typescript
function isDuplicate(newFact: string, existing: AgentFact[]): AgentFact | null {
  const normalized = normalize(newFact);
  for (const fact of existing) {
    // Simple similarity: Jaccard on word sets
    const similarity = jaccardSimilarity(normalized, normalize(fact.fact));
    if (similarity > 0.6) return fact; // duplicate — reinforce instead of add
  }
  return null;
}

function normalize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
}
```

Decision on match:
- **similarity > 0.6**: Reinforce existing fact (`reinforceCount++`, update `lastSeen`)
- **similarity ≤ 0.6**: Add as new fact
- **Max 50 facts per agent**: Evict least-reinforced when full

#### Injection format

```
===== AGENT KNOWLEDGE =====
Codebase: Uses TERM_HOVER/TERM_BORDER/TERM_SURFACE theme tokens for all interactive elements
Codebase: MultiPaneView uses PixiJS v8 with custom pagination component
Preference: User prefers solid borders with low opacity over dashed borders
Lesson: @types/node version conflicts are pre-existing; don't try to fix them
```

### 4.3 Layer 3 — Shared Knowledge (NEW)

Cross-agent knowledge that any agent can benefit from. Extracted from L2 facts when they have high `reinforceCount`.

#### Schema

```typescript
interface SharedKnowledge {
  /** The knowledge item */
  fact: string;

  /** Which agent first discovered this */
  source: string;

  /** How many agents have confirmed this */
  confirmedBy: string[];

  /** Timestamp */
  createdAt: string;
}
```

#### Promotion rule

When an L2 fact reaches `reinforceCount >= 3`, it's promoted to L3. Independent confirmation by another agent is tracked through `crossConfirmShared()`, which appends that agent to `confirmedBy`.

#### Injection format (for all agents)

```
===== PROJECT KNOWLEDGE =====
- This monorepo uses pnpm workspaces with apps/web (Next.js 15) and apps/gateway (Node.js daemon)
- Theme tokens are defined in packages/shared; always use TERM_* constants, never hardcode colors
- User rates projects on 5 axes: creativity, visual, interaction, completeness, engagement
```

### 4.4 Cross-Agent Context — L0 Summaries

When Agent A needs to know what Agent B is doing, instead of sharing Agent B's full history, inject a one-line **L0 summary**:

```typescript
function getAgentL0(agentId: string): string {
  const session = loadLatestSession(agentId);
  if (!session) return "idle (no recent activity)";
  return session.what; // e.g. "Optimized MultiPaneView pagination UI (commit ad8ed51)"
}

// Inject into team roster:
// [Alex 2] Last: "Optimized MultiPaneView pagination UI" (commit ad8ed51) — 10 min ago
// [Alex 3] Last: "Analyzed OpenViking and Mem0 for memory redesign" — just now
```

**Token cost**: ~30 tokens per agent (vs. ~2400 tokens if we shared raw messages)

---

## 5. Current Implementation Status

Implemented in `packages/memory/src/`:

- `index.ts`: public exports for commit/recovery/context/storage helpers
- `memory.ts`: L1/L2/L3 orchestration, work-state APIs, legacy wrappers, manual fact injection
- `extract.ts`: rule-based extraction for summaries, decisions, unfinished work, next steps, fact candidates
- `storage.ts`: JSON persistence with atomic temp-file writes and configurable root
- `format.ts`: prompt formatting for recovery, session history, agent knowledge, shared knowledge, legacy context
- `dedup.ts`: Jaccard-based dedup and shared-promotion logic
- `types.ts`: complete type surface including `WorkState` and `TaskCompletionData`

Exported APIs now include:

```typescript
commitSession()
buildRecoveryContext()
getMemoryContext()
getRecoveryString()
getAgentL0()
getWorkState()
updateWorkState()
clearAgentWorkState()
crossConfirmShared()
addManualFact()
```

Still intentionally out of scope:
- LLM-based fact extraction
- fact decay / TTL
- UI dashboard for inspecting memory

---

## 6. Token Budget

| Layer | When injected | Tokens | Frequency |
|-------|--------------|--------|-----------|
| L0 (cross-agent) | Team roster | ~30/agent | Every task in team mode |
| L1 (session summary) | Recovery only | ~150 | Only after session loss |
| Work state | Recovery only | ~100-180 | During interrupted/crashed sessions |
| L2 (agent facts) | Every task | ~200 (top 10 facts) | Every task |
| L3 (shared knowledge) | Every task | ~100 (top 5 items) | Every task |
| **Total new overhead** | | **~330 tokens steady-state** | Per task |

Compare to current:
- Current `recentMessages`: ~400 tokens (only on recovery, low value)
- Current `getMemoryContext()`: ~200 tokens (project history only)
- **New total**: ~530 tokens per task, but dramatically more useful

---

## 7. Evolution

```
v1 (legacy)           v2 (implemented)       v3 (possible future)
┌──────────┐         ┌──────────────┐        ┌──────────────────┐
│recentMsg │ ──────► │SessionSummary│ ──────► │SessionSummary    │
│(raw 6x   │         │(structured)  │        │+ richer extraction│
│ 400ch)   │         │              │        │+ memory tooling   │
├──────────┤         ├──────────────┤        │+ L0 Cross-Agent   │
│memory.ts │         │memory.ts     │        ├──────────────────┤
│(project  │         │+ work-state  │        │memory.ts         │
│ level)   │         │+ L2/L3       │        │(further extended)│
└──────────┘         └──────────────┘        └──────────────────┘
     100%                  100%                     100%
  compatible            compatible               compatible
```

The middle column reflects the code currently in the repository.

---

## 8. Example: Before vs After

### Scenario: Alex 2 session crashes after UI work

#### Before (current system)
```json
{
  "recovery": {
    "originalTask": "优化 MultiPaneView 翻页按钮",
    "lastResult": "There are changes in two files, but the agent-session.ts changes are from a different task",
    "recentMessages": [
      { "role": "assistant", "text": "Let me verify the build compiles:" },
      { "role": "assistant", "text": "Those errors are pre-existing @types/node version conflicts, not from my changes. Let me verify my file specifically has no issu" }
    ]
  }
}
```

Alex 2 after recovery: "I vaguely remember compiling something? Let me check git log..."

#### After (new system)
```json
{
  "sessionSummary": {
    "timestamp": "2026-03-17T14:30:00Z",
    "what": "Redesigned MultiPaneView pagination bar with styled arrow buttons and hover animations",
    "decisions": [
      "Changed borders from dashed to solid with lower opacity",
      "Used TERM_HOVER and TERM_BORDER theme tokens instead of hardcoded rgba",
      "Added scale(1.02) hover animation for interactive feel"
    ],
    "filesChanged": ["apps/web/src/components/MultiPaneView.tsx"],
    "commits": ["ad8ed51"],
    "unfinished": ["agent-session.ts recovery context improvements remain unstaged"],
    "tokens": { "input": 45000, "output": 12000 }
  },
  "agentFacts": [
    { "fact": "MultiPaneView uses PixiJS-rendered pagination with TERM_* theme tokens", "category": "codebase_pattern" },
    { "fact": "User prefers solid borders over dashed borders", "category": "user_preference" }
  ]
}
```

Alex 2 after recovery: "I was redesigning the pagination bar. I committed ad8ed51 with styled buttons and hover animations. The agent-session.ts changes are still unstaged — should I continue with those?"

---

## 9. Decision Log

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| No vector DB | File-based JSON | Qdrant, Chroma, FAISS | G4: Zero external deps. Our fact count (<50/agent) doesn't need ANN search |
| No LLM for extraction | Rule-based parsing | GPT-4o-mini, Ollama | G6: Zero token cost. Agent output is already structured enough to parse |
| Jaccard dedup over embeddings | Word-set overlap | Cosine similarity, LLM comparison | Sufficient for <50 facts. No embedding model dependency |
| Ring buffer (30 sessions) | Fixed size | Unlimited, LRU, TTL | Predictable storage cost with more recovery context |
| Promote at reinforceCount=3 | Threshold-based | Manual, voting | Simple, self-correcting. Bad facts decay naturally |
| Persist live work state | JSON snapshot | In-memory only | Required for crash-safe recovery before a successful session commit |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Rule-based extraction misses important facts | Medium | `addManualFact()` exists now; optional LLM extraction can be added later |
| Jaccard dedup produces false positives | Low | Threshold 0.6 is conservative; worst case = mild duplication |
| Fact accumulation slows prompt | Low | Hard cap at 50 facts/agent + 20 shared; top-N by reinforceCount |
| Session summary too brief | Medium | Include `recentMessages` as L1.5 fallback alongside structured summary |
| Breaking existing recovery flow | High | Keep `RecoveryContext.recentMessages` as fallback; new system is additive |

---

## 11. Future Extensions

- **Optional LLM extraction**: Use a small local model (Ollama) to extract richer facts at session end
- **Fact decay**: Auto-reduce `reinforceCount` over time for stale facts
- **Semantic search**: If fact count grows large (>200), add simple TF-IDF for retrieval
- **Memory dashboard**: UI in Open Office web app to inspect/edit/delete agent memories
- **Export/import**: Portable memory between machines (JSON export)

---

## Appendix: Comparison with Mem0 and OpenViking

| Feature | Mem0 | OpenViking | Our Design |
|---------|------|------------|------------|
| Storage | Vector DB (19 backends) | VikingFS (custom) | JSON files (zero deps) |
| Extraction | LLM on every `add()` | LLM on session commit | Rule-based (v1) / optional LLM (v2) |
| Dedup | LLM conflict resolution | Vector pre-filter + LLM | Jaccard word-set similarity |
| Layering | 4 tiers (conv/session/user/org) | 3 tiers (L0/L1/L2 by detail) | 4 layers (L0-L3 by scope + lifetime) |
| Cross-agent | Per user_id scoping | Directory hierarchy | L0 summaries + L3 shared facts |
| Token cost | High (LLM per operation) | Medium (LLM on commit) | Minimal (rule-based v1, LLM optional v2) |
| Dependencies | pip install + vector DB + LLM API | Go compiler + C++ + AGFS | None (pure TypeScript + JSON) |
| Best for | General AI apps, SaaS | Enterprise context management | Lightweight multi-agent orchestrator |
