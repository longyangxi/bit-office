// ---------------------------------------------------------------------------
// @bit-office/memory — Type definitions
//
// Four-layer memory model:
//   L0 Ephemeral  – in-memory conversation sliding window (managed by caller)
//   L1 Session    – per-task structured summaries (persisted)
//   L2 Agent      – per-agent long-term facts & preferences (persisted)
//   L3 Shared     – cross-agent project-wide knowledge (persisted)
// ---------------------------------------------------------------------------

/* ── L1: Session Summary ────────────────────────────────────────────────── */

export interface SessionSummary {
  /** ISO timestamp of session completion */
  timestamp: string;
  /** One-line description: "Optimized MultiPaneView pagination UI" */
  what: string;
  /** Key decisions made during this session */
  decisions: string[];
  /** Files created or modified (basenames or relative paths) */
  filesChanged: string[];
  /** Unfinished work or known issues */
  unfinished: string[];
  /** Git commits created (short hashes) */
  commits: string[];
  /** Token usage for this session */
  tokens: { input: number; output: number };
}

/** On-disk format for an agent's session history */
export interface SessionHistoryStore {
  /** Most recent summary (quick access) */
  latest: SessionSummary | null;
  /** Ring buffer of past summaries (newest first, max 10) */
  history: SessionSummary[];
}

/* ── L2: Agent Facts ────────────────────────────────────────────────────── */

export type FactCategory =
  | "user_preference"
  | "codebase_pattern"
  | "workflow_habit"
  | "lesson_learned";

export interface AgentFact {
  /** Stable ID for dedup (hash of normalized fact text) */
  id: string;
  /** Classification */
  category: FactCategory;
  /** The fact itself: "User prefers solid borders over dashed" */
  fact: string;
  /** How many sessions this fact has been relevant */
  reinforceCount: number;
  /** ISO timestamp when first observed */
  createdAt: string;
  /** ISO timestamp when last reinforced */
  lastSeen: string;
}

/** On-disk format for an agent's fact store */
export interface AgentFactStore {
  agentId: string;
  facts: AgentFact[];
}

/* ── L3: Shared Knowledge ───────────────────────────────────────────────── */

export interface SharedKnowledge {
  /** Stable ID */
  id: string;
  /** The knowledge item */
  fact: string;
  /** Which agent first discovered this */
  source: string;
  /** Which agents have independently confirmed this */
  confirmedBy: string[];
  /** ISO timestamp */
  createdAt: string;
}

/** On-disk format for the shared knowledge store */
export interface SharedKnowledgeStore {
  items: SharedKnowledge[];
}

/* ── Legacy compatibility (existing memory.ts types) ────────────────────── */

export interface ReviewPattern {
  pattern: string;
  count: number;
  lastSeen: number;
}

export interface ProjectRecord {
  summary: string;
  tech: string;
  completedAt: number;
  reviewPassed: boolean;
  ratings?: Record<string, number>;
}

export interface LegacyMemoryStore {
  reviewPatterns: ReviewPattern[];
  techPreferences: string[];
  projectHistory: ProjectRecord[];
}

/* ── Recovery Context (replaces agent-session.ts RecoveryContext) ─────── */

export interface RecoveryContext {
  /** Original task description */
  originalTask?: string;
  /** Current phase (for team agents) */
  phase?: string;
  /** L1 session summary (new — preferred) */
  sessionSummary?: SessionSummary;
  /** Legacy raw messages (fallback if no summary) */
  recentMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Last result text (legacy, kept for backward compat) */
  lastResult?: string;
}

/* ── Extraction input (what the caller provides after task completion) ── */

export interface TaskCompletionData {
  /** Agent identifier */
  agentId: string;
  /** Agent display name (for cross-agent context) */
  agentName?: string;
  /** Full stdout output from the task */
  stdout: string;
  /** Parsed summary line (from output parser) */
  summary?: string;
  /** Set of changed files (from tool_use tracking) */
  changedFiles: string[];
  /** Token counts */
  tokens: { input: number; output: number };
  /** Current conversation log (raw sliding window) */
  conversationLog?: Array<{ role: "user" | "assistant"; text: string }>;
}
