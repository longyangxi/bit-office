/**
 * AIBackend interface — consumers register their own implementations.
 * No concrete backends shipped in this package.
 *
 * Inspired by Overstory's AgentRuntime pattern: each CLI adapter knows
 * its own instruction file path, stability level, and capability flags.
 * See: https://github.com/jayminwest/overstory/blob/main/src/runtimes/types.ts
 */

export interface BuildArgsOpts {
  continue?: boolean;
  /** Resume a specific session by ID (preferred over --continue for multi-agent) */
  resumeSessionId?: string;
  fullAccess?: boolean;
  /** Override model for this invocation (e.g. "sonnet" for faster leader) */
  model?: string;
  /** Enable verbose output (default: false, enable via DEBUG env) */
  verbose?: boolean;
  /** Skip session resume for this invocation (leader state-summary mode) */
  skipResume?: boolean;
  /** Run as a specific subagent type (e.g. "Game Designer" → --agent "Game Designer") */
  agentType?: string;
  /** Use native worktree isolation (Claude Code --worktree) */
  worktree?: boolean;
}

/** Stability level of a backend adapter */
export type BackendStability = "stable" | "beta" | "experimental";

/** Guard mechanism supported by the backend */
export type GuardType = "hooks" | "sandbox" | "flag" | "none";

export interface AIBackend {
  id: string;
  name: string;
  command: string;
  buildArgs(prompt: string, opts: BuildArgsOpts): string[];
  /** Extra env vars to delete before spawning (e.g. CLAUDECODE) */
  deleteEnv?: string[];
  /** Whether this backend accepts stdin messages while running */
  supportsStdin?: boolean;

  // ── Overstory-inspired adapter metadata ──

  /**
   * Relative path to the instruction file within a worktree.
   * Each CLI reads its own convention:
   *   claude  → .claude/CLAUDE.md
   *   codex   → AGENTS.md
   *   gemini  → GEMINI.md
   *   copilot → .github/copilot-instructions.md
   *   cursor  → .cursor/rules/overstory.md
   *   aider   → .aider.conf.yml (or prompt via CLI)
   * Used by worktree setup to deploy agent instructions to the right path.
   */
  instructionPath?: string;

  /** Stability level: stable backends are production-tested, experimental may have gaps */
  stability?: BackendStability;

  /** What guard mechanism this backend supports for security boundaries */
  guardType?: GuardType;

  /** Whether this backend supports session resume (--resume / --continue) */
  supportsResume?: boolean;

  /** Whether this backend supports subagent types (--agent) */
  supportsAgentType?: boolean;

  /** Whether this backend supports native worktree isolation */
  supportsNativeWorktree?: boolean;

  /** Whether this backend outputs structured JSON (stream-json, NDJSON, etc.) */
  supportsStructuredOutput?: boolean;
}
