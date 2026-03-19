// ---------------------------------------------------------------------------
// @bit-office/memory — Deduplication engine
//
// Uses Jaccard similarity on word sets for fast, zero-dependency dedup.
// No vector DB, no embeddings, no LLM calls.
// ---------------------------------------------------------------------------

import type { AgentFact, SharedKnowledge } from "./types.js";
import { createHash } from "crypto";

/* ── Text normalization ─────────────────────────────────────────────────── */

/** Normalize text for comparison: lowercase, strip punctuation, split into word set. */
export function normalizeToWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2) // Drop trivial words
  );
}

/** Create a stable ID from fact text (for dedup key). */
export function hashFact(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/* ── Jaccard similarity ─────────────────────────────────────────────────── */

/**
 * Jaccard similarity coefficient: |A ∩ B| / |A ∪ B|
 * Returns 0.0 (completely different) to 1.0 (identical).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/* ── Fact dedup ─────────────────────────────────────────────────────────── */

export type DedupDecision =
  | { action: "add" }            // New fact — add it
  | { action: "reinforce"; existing: AgentFact }  // Duplicate — bump existing
  | { action: "skip" };          // Too generic or short — discard

const SIMILARITY_THRESHOLD = 0.6;

/**
 * Decide what to do with a new candidate fact given existing facts.
 */
export function dedupFact(
  candidateText: string,
  existing: AgentFact[],
): DedupDecision {
  const candidateWords = normalizeToWords(candidateText);

  // Reject very short word sets (likely too generic)
  if (candidateWords.size < 3) {
    return { action: "skip" };
  }

  // Check exact ID match first (same normalized text)
  const candidateId = hashFact(candidateText);
  const exactMatch = existing.find(f => f.id === candidateId);
  if (exactMatch) {
    return { action: "reinforce", existing: exactMatch };
  }

  // Check Jaccard similarity
  let bestMatch: AgentFact | null = null;
  let bestScore = 0;

  for (const fact of existing) {
    const factWords = normalizeToWords(fact.fact);
    const score = jaccardSimilarity(candidateWords, factWords);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = fact;
    }
  }

  if (bestScore >= SIMILARITY_THRESHOLD && bestMatch) {
    return { action: "reinforce", existing: bestMatch };
  }

  return { action: "add" };
}

/**
 * Decide if a fact should be promoted to shared knowledge.
 */
export function shouldPromoteToShared(
  fact: AgentFact,
  existingShared: SharedKnowledge[],
): boolean {
  // Must be reinforced enough (seen in 3+ sessions)
  if (fact.reinforceCount < 3) return false;

  // Check if already in shared (by similarity)
  const factWords = normalizeToWords(fact.fact);
  for (const item of existingShared) {
    const itemWords = normalizeToWords(item.fact);
    if (jaccardSimilarity(factWords, itemWords) >= SIMILARITY_THRESHOLD) {
      return false; // Already shared
    }
  }

  return true;
}
