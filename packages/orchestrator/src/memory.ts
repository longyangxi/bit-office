// ---------------------------------------------------------------------------
// AgentMemory — re-exports from @bit-office/memory
//
// This file is a thin wrapper that maintains backward compatibility
// for all existing consumers (orchestrator.ts, index.ts, gateway).
// The actual implementation now lives in packages/memory/.
// ---------------------------------------------------------------------------

export {
  // Legacy API (unchanged signatures)
  recordReviewFeedback,
  recordProjectCompletion,
  recordTechPreference,
  recordProjectRatings,
  getMemoryStore,
  clearMemory,

  // Enhanced API (new — accepts optional agentId for per-agent facts)
  getMemoryContext,

  // New memory system
  commitSession,
  buildRecoveryContext,
  getRecoveryString,
  getAgentL0,
  setStorageRoot,
  saveSessionHistory,
} from "@bit-office/memory";

export type { ReviewPattern, ProjectRecord } from "@bit-office/memory";
