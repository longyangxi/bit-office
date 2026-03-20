// ---------------------------------------------------------------------------
// @bit-office/memory — Intelligent memory layer for AI agents
//
// Four-layer memory model:
//   L0: Ephemeral (conversation sliding window — managed by caller)
//   L1: Session   (structured task summaries — persisted)
//   L2: Agent     (per-agent learned facts — persisted)
//   L3: Shared    (cross-agent project knowledge — persisted)
//
// Usage:
//   import { commitSession, getMemoryContext, getAgentL0 } from "@bit-office/memory";
//
//   // On task completion:
//   const summary = commitSession({ agentId, stdout, changedFiles, tokens, ... });
//
//   // For prompt injection:
//   const context = getMemoryContext(agentId);
//
//   // For cross-agent roster:
//   const l0 = getAgentL0(agentId, "Alex 2");
// ---------------------------------------------------------------------------

// Core operations
export {
  commitSession,
  buildRecoveryContext,
  getMemoryContext,
  getRecoveryString,
  getAgentL0,
  crossConfirmShared,
  addManualFact,
  // Inspection/debug
  getSessionHistory,
  getAgentFacts,
  getSharedKnowledge,
  // Legacy wrappers (drop-in replacements for old memory.ts)
  recordReviewFeedback,
  recordProjectCompletion,
  recordTechPreference,
  recordProjectRatings,
  getMemoryStore,
  clearMemory,
} from "./memory.js";

// Storage configuration
export { setStorageRoot, getStorageRoot, saveSessionHistory } from "./storage.js";

// Types (for consumers who need to type-check)
export type {
  SessionSummary,
  SessionHistoryStore,
  AgentFact,
  AgentFactStore,
  FactCategory,
  SharedKnowledge,
  SharedKnowledgeStore,
  RecoveryContext,
  TaskCompletionData,
  // Legacy types
  ReviewPattern,
  ProjectRecord,
  LegacyMemoryStore,
} from "./types.js";

// Low-level utilities (for advanced use cases)
export { extractSessionSummary, extractFactCandidates, createFact } from "./extract.js";
export { jaccardSimilarity, normalizeToWords, hashFact, dedupFact, shouldPromoteToShared } from "./dedup.js";
export {
  formatRecoveryContext,
  formatAgentL0,
  formatAgentFacts,
  formatSharedKnowledge,
  formatSessionHistory,
  formatLegacyMemoryContext,
} from "./format.js";
