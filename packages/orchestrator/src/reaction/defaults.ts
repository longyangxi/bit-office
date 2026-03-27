import type { ReactionRule } from "./types.js";

/**
 * Default reaction rules — preserve the exact behavior of:
 * - retry.ts (maxRetries: 2, escalateToLeader)
 * - delegation.ts (maxDirectFixes: 1, then escalate)
 * - config.ts (hardCeilingRounds: 10 → force-finalize)
 * - NEW: agent:stuck detection at 5 min
 */
export const DEFAULT_RULES: ReactionRule[] = [
  // Was: RetryTracker with maxRetries=2, escalateToLeader=true
  // Skip timeouts and cancellations (they won't benefit from retry)
  {
    trigger: "task:failed",
    match: { wasTimeout: false },
    action: "retry",
    retries: 2,
    escalateAction: "escalate-to-leader",
  },

  // Was: delegation.ts tryDirectFix() with maxDirectFixes=1
  // First FAIL → send to dev for direct fix, second FAIL → escalate to leader
  {
    trigger: "review:fail",
    action: "send-to-agent",
    retries: 1,
    escalateAction: "escalate-to-leader",
  },

  // Was: config.ts hardCeilingRounds=10 → synthetic task:done
  {
    trigger: "delegation:budget",
    action: "force-finalize",
  },

  // New: detect stuck agents (no output for 5 minutes)
  {
    trigger: "agent:stuck",
    thresholdMs: 300_000,
    action: "notify",
  },
];
