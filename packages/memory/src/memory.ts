// ---------------------------------------------------------------------------
// @bit-office/memory — Core memory manager
//
// Main entry point for all memory operations. Orchestrates:
//   - L1 session summary creation and storage
//   - L2 agent fact extraction, dedup, and storage
//   - L3 shared knowledge promotion
//   - Legacy memory operations (backward compatible)
//   - Prompt context generation (for injection into agent prompts)
// ---------------------------------------------------------------------------

import type {
  TaskCompletionData,
  SessionSummary,
  AgentFact,
  SharedKnowledge,
  RecoveryContext,
  ReviewPattern,
  ProjectRecord,
  AgentFactStore,
} from "./types.js";

import {
  loadSessionHistory,
  saveSessionHistory,
  loadWorkState,
  saveWorkState,
  clearWorkState,
  loadAgentFacts,
  saveAgentFacts,
  loadSharedKnowledge,
  saveSharedKnowledge,
  loadLegacyMemory,
  saveLegacyMemory,
} from "./storage.js";

import { extractSessionSummary, extractFactCandidates, createFact, extractWorkStateSnapshot } from "./extract.js";
import { dedupFact, shouldPromoteToShared, hashFact } from "./dedup.js";
import {
  formatRecoveryContext,
  formatAgentL0,
  formatAgentFacts,
  formatSharedKnowledge,
  formatSessionHistory,
  formatLegacyMemoryContext,
} from "./format.js";

/* ── Constants ──────────────────────────────────────────────────────────── */

const MAX_SESSION_HISTORY = 30;
const MAX_AGENT_FACTS = 50;
const MAX_SHARED_ITEMS = 20;

/* ── L1: Session operations ─────────────────────────────────────────────── */

/**
 * Process task completion: extract session summary, save it, and
 * extract+save any reusable facts. This is the main "commit" operation.
 *
 * Call this when an agent task completes successfully (exit code 0).
 */
export function commitSession(data: TaskCompletionData): SessionSummary {
  const { agentId } = data;

  // 1. Extract structured session summary (L1)
  const summary = extractSessionSummary(data);

  // 2. Save to session history (ring buffer)
  const sessionStore = loadSessionHistory(agentId);
  sessionStore.latest = summary;
  sessionStore.history.unshift(summary);
  if (sessionStore.history.length > MAX_SESSION_HISTORY) {
    sessionStore.history = sessionStore.history.slice(0, MAX_SESSION_HISTORY);
  }
  saveSessionHistory(agentId, sessionStore);
  console.log(`[Memory:L1] Session committed for ${agentId}: "${summary.what.slice(0, 60)}"`);

  // 3. Extract and save agent facts (L2)
  const factCandidates = extractFactCandidates(data.stdout);
  if (factCandidates.length > 0) {
    const factStore = loadAgentFacts(agentId);
    let added = 0;
    let reinforced = 0;

    for (const candidate of factCandidates) {
      const decision = dedupFact(candidate.fact, factStore.facts);

      switch (decision.action) {
        case "add": {
          factStore.facts.push(createFact(candidate));
          added++;
          break;
        }
        case "reinforce": {
          decision.existing.reinforceCount++;
          decision.existing.lastSeen = new Date().toISOString();
          reinforced++;
          break;
        }
        case "skip":
          break;
      }
    }

    // Enforce max facts: evict least reinforced
    if (factStore.facts.length > MAX_AGENT_FACTS) {
      factStore.facts.sort((a, b) => b.reinforceCount - a.reinforceCount);
      factStore.facts = factStore.facts.slice(0, MAX_AGENT_FACTS);
    }

    saveAgentFacts(agentId, factStore);
    if (added > 0 || reinforced > 0) {
      console.log(`[Memory:L2] Facts for ${agentId}: +${added} new, ${reinforced} reinforced, ${factStore.facts.length} total`);
    }

    // 4. Check for L3 promotions
    promoteToShared(agentId, factStore);
  }

  return summary;
}

/**
 * Build a RecoveryContext from stored memory (for session loss recovery).
 * Uses the new structured format if available, falls back to legacy.
 */
export function buildRecoveryContext(
  agentId: string,
  opts?: {
    originalTask?: string;
    phase?: string;
    /** Legacy fallback: raw last result text */
    lastResult?: string;
    /** Legacy fallback: raw conversation log */
    recentMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  },
): RecoveryContext {
  const sessionStore = loadSessionHistory(agentId);

  // Include up to 10 older sessions (skip index 0 = latest, already in sessionSummary)
  const olderHistory = sessionStore.history.slice(1, 11);
  const workState = loadWorkState(agentId);

  return {
    originalTask: opts?.originalTask,
    phase: opts?.phase,
    workState: workState ?? undefined,
    sessionSummary: sessionStore.latest ?? undefined,
    recentHistory: olderHistory.length > 0 ? olderHistory : undefined,
    lastResult: opts?.lastResult,
    recentMessages: opts?.recentMessages,
  };
}

/* ── L3: Shared knowledge promotion ─────────────────────────────────────── */

function promoteToShared(agentId: string, factStore: AgentFactStore): void {
  const shared = loadSharedKnowledge();
  let promoted = 0;

  for (const fact of factStore.facts) {
    if (shouldPromoteToShared(fact, shared.items)) {
      shared.items.push({
        id: hashFact(fact.fact),
        fact: fact.fact,
        source: agentId,
        confirmedBy: [agentId],
        createdAt: new Date().toISOString(),
      });
      promoted++;
    }
  }

  // Enforce max shared items
  if (shared.items.length > MAX_SHARED_ITEMS) {
    shared.items = shared.items.slice(0, MAX_SHARED_ITEMS);
  }

  if (promoted > 0) {
    saveSharedKnowledge(shared);
    console.log(`[Memory:L3] Promoted ${promoted} fact(s) to shared knowledge`);
  }
}

/**
 * Cross-confirm: when another agent independently discovers a shared fact,
 * add them to confirmedBy.
 */
export function crossConfirmShared(agentId: string, factText: string): boolean {
  const shared = loadSharedKnowledge();
  const factId = hashFact(factText);
  const item = shared.items.find(s => s.id === factId);
  if (item && !item.confirmedBy.includes(agentId)) {
    item.confirmedBy.push(agentId);
    saveSharedKnowledge(shared);
    return true;
  }
  return false;
}

/* ── Context generation (for prompt injection) ──────────────────────────── */

/**
 * Get full memory context for an agent's prompt.
 * Combines: legacy memory + agent facts (L2) + shared knowledge (L3).
 */
export function getMemoryContext(agentId?: string): string {
  const sections: string[] = [];

  // Legacy context (review patterns, tech prefs, project history)
  const legacy = formatLegacyMemoryContext(loadLegacyMemory());
  if (legacy) sections.push(legacy);

  // Agent-specific facts (L2)
  if (agentId) {
    const factStore = loadAgentFacts(agentId);
    const agentCtx = formatAgentFacts(factStore.facts);
    if (agentCtx) sections.push(agentCtx);
  }

  // Shared knowledge (L3)
  const shared = formatSharedKnowledge(loadSharedKnowledge().items);
  if (shared) sections.push(shared);

  // L1 session history (recent work summary — ~20 tokens per entry)
  if (agentId) {
    const sessionStore = loadSessionHistory(agentId);
    const sessionCtx = formatSessionHistory(sessionStore);
    if (sessionCtx) sections.push(sessionCtx);
  }

  return sections.join("\n");
}

/**
 * Get recovery context string for an agent whose session was lost.
 */
export function getRecoveryString(recovery: RecoveryContext): string {
  return formatRecoveryContext(recovery);
}

/**
 * Get a one-line L0 summary of an agent's latest work.
 * For cross-agent context in team rosters.
 */
export function getAgentL0(agentId: string, agentName: string): string {
  const store = loadSessionHistory(agentId);
  return formatAgentL0(agentName, store);
}

/**
 * Get session history for an agent (for inspection/debugging).
 */
export function getSessionHistory(agentId: string) {
  return loadSessionHistory(agentId);
}

export function getWorkState(agentId: string) {
  return loadWorkState(agentId);
}

export function updateWorkState(data: {
  agentId: string;
  stdout: string;
  taskPrompt?: string;
  taskId?: string;
  cwd?: string;
  changedFiles: string[];
  status: "running" | "interrupted" | "failed" | "cancelled";
  startedAt: string;
  lastActivity?: string;
}): void {
  const state = extractWorkStateSnapshot(data);
  saveWorkState(data.agentId, state);
}

export function clearAgentWorkState(agentId: string): void {
  clearWorkState(agentId);
}

/**
 * Get agent facts for an agent (for inspection/debugging).
 */
export function getAgentFacts(agentId: string) {
  return loadAgentFacts(agentId);
}

/**
 * Get all shared knowledge (for inspection/debugging).
 */
export function getSharedKnowledge() {
  return loadSharedKnowledge();
}

/* ── Legacy operations (backward-compatible wrappers) ───────────────────── */

/** Normalize an issue string for deduplication. */
function normalizeIssue(issue: string): string {
  return issue.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export function recordReviewFeedback(reviewOutput: string): void {
  const verdictMatch = reviewOutput.match(/VERDICT[:\s]*(\w+)/i);
  if (!verdictMatch || verdictMatch[1].toUpperCase() !== "FAIL") return;

  const issueLines: string[] = [];
  const issueRe = /^\s*\d+[.)]\s*(.+)/gm;
  let match;
  while ((match = issueRe.exec(reviewOutput)) !== null) {
    const issue = match[1].trim();
    if (issue.length > 10 && issue.length < 200) issueLines.push(issue);
  }
  if (issueLines.length === 0) return;

  const store = loadLegacyMemory();
  const now = Date.now();
  for (const issue of issueLines) {
    const normalized = normalizeIssue(issue);
    const existing = store.reviewPatterns.find(p => normalizeIssue(p.pattern) === normalized);
    if (existing) {
      existing.count++;
      existing.lastSeen = now;
    } else {
      store.reviewPatterns.push({ pattern: issue, count: 1, lastSeen: now });
    }
  }
  store.reviewPatterns.sort((a, b) => b.count - a.count);
  store.reviewPatterns = store.reviewPatterns.slice(0, 20);
  saveLegacyMemory(store);
  console.log(`[Memory] Recorded ${issueLines.length} review pattern(s)`);
}

export function recordProjectCompletion(summary: string, tech: string, reviewPassed: boolean): void {
  const store = loadLegacyMemory();
  store.projectHistory.push({
    summary: summary.slice(0, 300),
    tech: tech.slice(0, 100),
    completedAt: Date.now(),
    reviewPassed,
  });
  if (store.projectHistory.length > 50) {
    store.projectHistory = store.projectHistory.slice(-50);
  }
  saveLegacyMemory(store);
  console.log(`[Memory] Recorded project completion: ${summary.slice(0, 80)}`);
}

export function recordTechPreference(tech: string): void {
  const store = loadLegacyMemory();
  const normalized = tech.trim().toLowerCase();
  if (!store.techPreferences.some(t => t.toLowerCase() === normalized)) {
    store.techPreferences.push(tech.trim());
    if (store.techPreferences.length > 10) {
      store.techPreferences = store.techPreferences.slice(-10);
    }
    saveLegacyMemory(store);
    console.log(`[Memory] Recorded tech preference: ${tech}`);
  }
}

export function recordProjectRatings(ratings: Record<string, number>): void {
  const store = loadLegacyMemory();
  if (store.projectHistory.length === 0) return;
  store.projectHistory[store.projectHistory.length - 1].ratings = ratings;
  saveLegacyMemory(store);
  const avg = Object.values(ratings);
  const mean = avg.length > 0 ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1) : "?";
  console.log(`[Memory] Updated latest project ratings (avg ${mean}/5)`);
}

export function getMemoryStore() {
  return loadLegacyMemory();
}

export function clearMemory(): void {
  saveLegacyMemory({ reviewPatterns: [], techPreferences: [], projectHistory: [] });
  console.log(`[Memory] All memory cleared`);
}

/**
 * Manually add a fact to an agent's knowledge base.
 * Useful for injecting facts from external sources.
 */
export function addManualFact(
  agentId: string,
  fact: string,
  category: AgentFact["category"] = "lesson_learned",
): void {
  const store = loadAgentFacts(agentId);
  const decision = dedupFact(fact, store.facts);

  if (decision.action === "add") {
    store.facts.push(createFact({ fact, category }));
    saveAgentFacts(agentId, store);
    console.log(`[Memory:L2] Manual fact added for ${agentId}: "${fact.slice(0, 60)}"`);
  } else if (decision.action === "reinforce") {
    decision.existing.reinforceCount++;
    decision.existing.lastSeen = new Date().toISOString();
    saveAgentFacts(agentId, store);
    console.log(`[Memory:L2] Manual fact reinforced for ${agentId}`);
  }
}
