// ---------------------------------------------------------------------------
// Centralized configuration constants for the orchestrator package.
// All magic numbers live here — easy to tune, easy to find.
// ---------------------------------------------------------------------------

export const CONFIG = {
  delegation: {
    /** Maximum delegation chain depth (user → lead → dev → reviewer → ...) */
    maxDepth: 5,
    /** Maximum total delegations per team session */
    maxTotal: 20,
    /** Maximum leader invocation rounds (after receiving results) */
    budgetRounds: 7,
    /** Force-complete after this many leader rounds (safety ceiling) */
    hardCeilingRounds: 10,
    /** Maximum code review iterations before accepting as-is */
    maxReviewRounds: 3,
    /** Maximum direct fix attempts (reviewer → dev) before escalating to leader */
    maxDirectFixes: 1,
  },

  timing: {
    /** Wait for straggler workers before flushing partial results to leader (ms) */
    resultBatchWindowMs: 20_000,
    /** Leader task timeout — delegation planning only, no tools (ms) */
    leaderTimeoutMs: 3 * 60 * 1000,
    /** Worker task timeout — real coding with full tool access (ms) */
    workerTimeoutMs: 30 * 60 * 1000,
    /** Delay before setting agent status back to idle after task completion (ms) */
    idleDoneDelayMs: 5_000,
    /** Delay before setting agent status back to idle after task failure (ms) */
    idleErrorDelayMs: 3_000,
    /** Delay before dequeuing next task (ms) */
    dequeueDelayMs: 100,
    /** Delay before retrying a failed task (ms) */
    retryDelayMs: 500,
  },

  limits: {
    /** Max chars for team chat messages (results, delegations, completions) */
    chatMessageChars: 2000,
    /** Max chars for activity intent (short activity feed summaries) */
    intentChars: 500,
    /** Max lines / chars for fallback summary when no SUMMARY field is found */
    fallbackSummaryLines: 20,
    fallbackSummaryChars: 2000,
  },

  preview: {
    /** Port for static file serving (npx serve) */
    staticPort: 9199,
    /** Common build output directories to scan for index.html */
    buildOutputCandidates: [
      "dist/index.html",
      "build/index.html",
      "out/index.html",
      "index.html",
      "public/index.html",
    ],
    /** File extension → runner command mapping for auto-constructing previewCmd */
    runners: {
      ".py": "python3",
      ".js": "node",
      ".rb": "ruby",
      ".sh": "bash",
    } as Record<string, string>,
  },
} as const;
