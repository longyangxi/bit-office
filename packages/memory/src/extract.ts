// ---------------------------------------------------------------------------
// @bit-office/memory — Extraction engine
//
// Parses agent stdout output to produce:
//   - L1 SessionSummary (structured task summary)
//   - L2 AgentFact candidates (reusable facts for future sessions)
//
// DESIGN: Rule-based only (v1). No LLM calls = zero token cost.
// All data comes from what the agent already printed.
// ---------------------------------------------------------------------------

import type { SessionSummary, AgentFact, FactCategory, TaskCompletionData } from "./types.js";
import { hashFact } from "./dedup.js";

/* ── L1: Session Summary extraction ─────────────────────────────────────── */

/**
 * Extract a structured session summary from task completion data.
 * This replaces the old "raw recentMessages" approach.
 */
export function extractSessionSummary(data: TaskCompletionData): SessionSummary {
  const { stdout, summary, changedFiles, tokens } = data;

  return {
    timestamp: new Date().toISOString(),
    what: extractWhat(stdout, summary),
    decisions: extractDecisions(stdout),
    filesChanged: changedFiles.map(f => {
      // Shorten absolute paths to relative-ish basenames
      const parts = f.split("/");
      // Keep last 3 segments: e.g. "src/components/MultiPaneView.tsx"
      return parts.length > 3 ? parts.slice(-3).join("/") : f;
    }),
    unfinished: extractUnfinished(stdout),
    commits: extractCommits(stdout),
    tokens,
  };
}

/** Extract the "what" — one-line summary of what was done. */
function extractWhat(stdout: string, parsedSummary?: string): string {
  // Prefer the parsed SUMMARY field from output parser
  if (parsedSummary && parsedSummary.length > 10) {
    return parsedSummary.slice(0, 200);
  }

  // Try to find STATUS: done lines followed by SUMMARY:
  const summaryMatch = stdout.match(/SUMMARY:\s*(.+)/i);
  if (summaryMatch) return summaryMatch[1].trim().slice(0, 200);

  // Try "Here's what I" pattern (common in agent conclusions)
  const hereMatch = stdout.match(/[Hh]ere'?s what (?:I|we)\s+(?:did|changed|built|implemented|created)[:\s]*(.{10,200})/);
  if (hereMatch) return hereMatch[1].trim();

  // Fall back to first substantial non-tool line (agent's opening statement)
  const lines = stdout.split("\n").filter(l => {
    const t = l.trim();
    return t.length > 20 && !t.startsWith("{") && !t.startsWith("Running") && !t.startsWith("Using ");
  });
  if (lines.length > 0) return lines[0].trim().slice(0, 200);

  return "Task completed";
}

/** Extract key decisions from agent output. */
function extractDecisions(stdout: string): string[] {
  const decisions: string[] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    const t = line.trim();

    // Pattern: "Changed X from Y to Z" / "Changed X to Y"
    const changeMatch = t.match(/[Cc]hanged?\s+(.{5,120})\s+(?:from\s+.{2,40}\s+)?to\s+(.{2,80})/);
    if (changeMatch) {
      decisions.push(t.slice(0, 150));
      continue;
    }

    // Pattern: "Used X instead of Y" / "Chose X over Y"
    const choiceMatch = t.match(/(?:[Uu]sed|[Cc]hose|[Pp]icked|[Ss]witched to)\s+(.{5,80})\s+(?:instead of|over|rather than)\s+(.{3,80})/);
    if (choiceMatch) {
      decisions.push(t.slice(0, 150));
      continue;
    }

    // Pattern: bullet points with "because" / "since" / "for consistency"
    if (/^[-*>•]\s/.test(t) && /\b(?:because|since|for\s+(?:consistency|better|cleaner|proper))\b/i.test(t)) {
      decisions.push(t.replace(/^[-*>•]\s+/, "").slice(0, 150));
      continue;
    }
  }

  // Deduplicate and limit
  return [...new Set(decisions)].slice(0, 5);
}

/** Extract git commits from agent output. */
function extractCommits(stdout: string): string[] {
  const commits = new Set<string>();

  // Pattern: "Committed `abc1234`" or "commit abc1234" or "ad8ed51"
  const patterns = [
    /[Cc]ommit(?:ted)?\s+`?([a-f0-9]{7,12})`?/g,
    /\bcommit\s+([a-f0-9]{7,40})\b/g,
    /\[[\w/]+\s+([a-f0-9]{7,12})\]\s/g, // git output: [branch abc1234] message
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(stdout)) !== null) {
      commits.add(match[1].slice(0, 12));
    }
  }

  return [...commits].slice(0, 5);
}

/** Extract unfinished work / TODOs from agent output. */
function extractUnfinished(stdout: string): string[] {
  const items: string[] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    const t = line.trim();

    // Pattern: "TODO:" / "Unfinished:" / "Remaining:" / "Still need to"
    if (/^(?:TODO|FIXME|Unfinished|Remaining|Still need|Left to do)[:\s]/i.test(t)) {
      items.push(t.replace(/^(?:TODO|FIXME|Unfinished|Remaining|Still need to|Left to do)[:\s]+/i, "").slice(0, 150));
      continue;
    }

    // Pattern: "X remain(s) unstaged/uncommitted/unfinished"
    if (/\b(?:remain|still|not yet|haven'?t)\b.*\b(?:unstaged|uncommitted|unfinished|incomplete|pending)\b/i.test(t)) {
      items.push(t.slice(0, 150));
      continue;
    }
  }

  return [...new Set(items)].slice(0, 3);
}

/* ── L2: Agent Fact extraction ──────────────────────────────────────────── */

interface FactCandidate {
  fact: string;
  category: FactCategory;
}

/**
 * Rule-based extraction patterns for reusable facts.
 * Each pattern targets a specific category of knowledge that's
 * useful in future sessions (not task-specific details).
 */
const FACT_PATTERNS: Array<{
  regex: RegExp;
  category: FactCategory;
  /** Capture group index to use as fact text (0 = full match) */
  group: number;
}> = [
  // User preferences
  { regex: /[Uu]ser\s+(?:prefers?|likes?|wants?|asked for|requested)\s+(.{10,100})/g, category: "user_preference", group: 0 },
  { regex: /[Cc]hanged?\s+(?:to|from)\s+.{3,30}\s+(?:per|as)\s+user(?:'s)?\s+(?:preference|request)\b(.{0,50})/g, category: "user_preference", group: 0 },

  // Codebase patterns
  { regex: /(?:this|the)\s+(?:codebase|project|repo|app)\s+(?:uses?|has|requires?)\s+(.{10,100})/gi, category: "codebase_pattern", group: 0 },
  { regex: /(?:always|must|should)\s+use\s+(TERM_\w+|[A-Z_]{5,})\s+(?:for|instead|token|constant)/gi, category: "codebase_pattern", group: 0 },
  { regex: /theme\s+(?:tokens?|colors?|variables?)\s+(?:are|defined|live)\s+(?:in|at)\s+(.{10,80})/gi, category: "codebase_pattern", group: 0 },

  // Workflow habits
  { regex: /(?:always|never|make sure to)\s+(.{10,80})\s+before\s+(?:committing|pushing|deploying)/gi, category: "workflow_habit", group: 0 },

  // Lessons learned
  { regex: /(?:note|important|remember|caution|warning|careful)[:\s]+(.{10,120})/gi, category: "lesson_learned", group: 1 },
  { regex: /(?:pre-existing|known issue|don'?t (?:try to )?fix)[:\s]*(.{10,100})/gi, category: "lesson_learned", group: 0 },
  { regex: /(?:errors?|warnings?)\s+(?:are|is)\s+pre-existing\b(.{0,80})/gi, category: "lesson_learned", group: 0 },
];

/**
 * Extract reusable facts from agent output.
 * Returns candidate facts (not yet deduped against existing store).
 */
export function extractFactCandidates(stdout: string): FactCandidate[] {
  const candidates: FactCandidate[] = [];
  const seen = new Set<string>();

  for (const { regex, category, group } of FACT_PATTERNS) {
    // Reset lastIndex for global regexes
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(stdout)) !== null) {
      const raw = (group === 0 ? match[0] : match[group] ?? match[0]).trim();
      // Clean up: remove leading punctuation, normalize whitespace
      const cleaned = raw
        .replace(/^[-*>•:]+\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned.length < 10 || cleaned.length > 200) continue;

      // Simple dedup within this extraction
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({ fact: cleaned, category });
    }
  }

  return candidates.slice(0, 10); // Max 10 candidates per task
}

/**
 * Convert a fact candidate into a full AgentFact with ID and timestamps.
 */
export function createFact(candidate: FactCandidate): AgentFact {
  const now = new Date().toISOString();
  return {
    id: hashFact(candidate.fact),
    category: candidate.category,
    fact: candidate.fact,
    reinforceCount: 1,
    createdAt: now,
    lastSeen: now,
  };
}
