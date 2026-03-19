// ---------------------------------------------------------------------------
// @bit-office/memory — Prompt formatting
//
// Converts stored memory into text strings for injection into agent prompts.
// Each formatter targets a specific use case with minimal token overhead.
// ---------------------------------------------------------------------------

import type {
  SessionSummary,
  SessionHistoryStore,
  AgentFact,
  SharedKnowledge,
  RecoveryContext,
  LegacyMemoryStore,
} from "./types.js";

/* ── L1: Recovery context string ────────────────────────────────────────── */

/**
 * Format recovery context for an agent whose session was lost.
 * Prefers structured SessionSummary over raw recentMessages.
 *
 * Target: ~150 tokens (vs. ~400 tokens for old raw format).
 */
export function formatRecoveryContext(recovery: RecoveryContext): string {
  const lines: string[] = [
    "[Session recovered] Your previous session was lost. Here's what you were doing:",
  ];

  if (recovery.originalTask) {
    lines.push(`- Task: ${recovery.originalTask}`);
  }
  if (recovery.phase) {
    lines.push(`- Phase: ${recovery.phase}`);
  }

  // Prefer structured summary over raw messages
  if (recovery.sessionSummary) {
    const s = recovery.sessionSummary;
    lines.push(`- What you did: ${s.what}`);

    if (s.filesChanged.length > 0) {
      lines.push(`- Files changed: ${s.filesChanged.join(", ")}`);
    }
    if (s.commits.length > 0) {
      lines.push(`- Commits: ${s.commits.join(", ")}`);
    }
    if (s.decisions.length > 0) {
      lines.push(`- Key decisions:`);
      for (const d of s.decisions.slice(0, 3)) {
        lines.push(`  - ${d}`);
      }
    }
    if (s.unfinished.length > 0) {
      lines.push(`- Unfinished:`);
      for (const u of s.unfinished) {
        lines.push(`  - ${u}`);
      }
    }
  } else if (recovery.lastResult) {
    // Legacy fallback
    lines.push(`- Last result: ${recovery.lastResult}`);
    if (recovery.recentMessages?.length) {
      lines.push("- Recent conversation:");
      for (const msg of recovery.recentMessages) {
        const label = msg.role === "user" ? "User" : "You";
        lines.push(`  [${label}]: ${msg.text}`);
      }
    }
  }

  lines.push("Note: You don't have full conversation history. Ask the user if unsure about details.");
  return lines.join("\n");
}

/* ── L0: Cross-agent one-liner ──────────────────────────────────────────── */

/**
 * Generate a one-line L0 summary for cross-agent context.
 * ~30 tokens per agent.
 */
export function formatAgentL0(
  agentName: string,
  sessionStore: SessionHistoryStore,
): string {
  if (!sessionStore.latest) {
    return `[${agentName}] idle (no recent activity)`;
  }

  const s = sessionStore.latest;
  const timeAgo = formatTimeAgo(s.timestamp);
  const commits = s.commits.length > 0 ? ` (${s.commits.join(", ")})` : "";
  return `[${agentName}] Last: "${s.what}"${commits} — ${timeAgo}`;
}

/* ── L2: Agent facts for prompt injection ───────────────────────────────── */

/**
 * Format agent facts for prompt injection.
 * Top N facts sorted by reinforceCount, grouped by category.
 * Target: ~200 tokens.
 */
export function formatAgentFacts(facts: AgentFact[], maxItems = 10): string {
  if (facts.length === 0) return "";

  // Sort by reinforceCount (most reinforced first), then by lastSeen
  const sorted = [...facts]
    .sort((a, b) => b.reinforceCount - a.reinforceCount || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, maxItems);

  const CATEGORY_LABELS: Record<string, string> = {
    user_preference: "Preference",
    codebase_pattern: "Codebase",
    workflow_habit: "Workflow",
    lesson_learned: "Lesson",
  };

  const lines = sorted.map(f => {
    const label = CATEGORY_LABELS[f.category] ?? f.category;
    return `- ${label}: ${f.fact}`;
  });

  return `\n===== AGENT KNOWLEDGE =====\n${lines.join("\n")}\n`;
}

/* ── L3: Shared knowledge for prompt injection ──────────────────────────── */

/**
 * Format shared knowledge for prompt injection.
 * Target: ~100 tokens.
 */
export function formatSharedKnowledge(items: SharedKnowledge[], maxItems = 5): string {
  if (items.length === 0) return "";

  const lines = items
    .slice(0, maxItems)
    .map(item => `- ${item.fact}`);

  return `\n===== PROJECT KNOWLEDGE =====\n${lines.join("\n")}\n`;
}

/* ── Legacy: backward-compatible memory context ─────────────────────────── */

/**
 * Generate the same format as the old `getMemoryContext()`.
 * This ensures backward compatibility during migration.
 */
export function formatLegacyMemoryContext(store: LegacyMemoryStore): string {
  const sections: string[] = [];

  // Top review patterns (count >= 2 = recurring issue)
  const recurring = store.reviewPatterns.filter(p => p.count >= 2);
  if (recurring.length > 0) {
    const lines = recurring.slice(0, 5).map(p => `- ${p.pattern} (flagged ${p.count}x)`);
    sections.push(`COMMON REVIEW ISSUES (avoid these):\n${lines.join("\n")}`);
  }

  // Recent tech preferences
  if (store.techPreferences.length > 0) {
    const recent = store.techPreferences.slice(-3);
    sections.push(`USER'S PREFERRED TECH: ${recent.join(", ")}`);
  }

  // Recent project history with ratings
  const rated = store.projectHistory
    .filter(p => p.ratings && Object.keys(p.ratings).length > 0)
    .slice(-3);
  if (rated.length > 0) {
    const lines = rated.map(p => {
      const r = p.ratings!;
      const scores = Object.entries(r).map(([k, v]) => `${k}:${v}/5`).join(", ");
      const avg = Object.values(r).reduce((a, b) => a + b, 0) / Object.values(r).length;
      const weak = Object.entries(r).filter(([, v]) => v <= 2).map(([k]) => k);
      let line = `- "${p.summary.slice(0, 60)}" [${scores}] avg=${avg.toFixed(1)}`;
      if (weak.length > 0) line += ` → improve: ${weak.join(", ")}`;
      return line;
    });
    sections.push(`PAST PROJECT RATINGS (learn from user feedback):\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `\n===== LEARNED FROM PREVIOUS PROJECTS =====\n${sections.join("\n\n")}\n`;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function formatTimeAgo(isoTimestamp: string): string {
  const diff = Date.now() - Date.parse(isoTimestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
