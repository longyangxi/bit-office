/**
 * AIBackend interface — consumers register their own implementations.
 * No concrete backends shipped in this package.
 */

export interface BuildArgsOpts {
  continue?: boolean;
  /** Resume a specific session by ID (preferred over --continue for multi-agent) */
  resumeSessionId?: string;
  fullAccess?: boolean;
  noTools?: boolean;
  /** Override model for this invocation (e.g. "sonnet" for faster leader) */
  model?: string;
  /** Enable verbose output (default: false, enable via DEBUG env) */
  verbose?: boolean;
  /** Skip session resume for this invocation (leader state-summary mode) */
  skipResume?: boolean;
  /** Run as a specific subagent type (e.g. "Game Designer" → --agent "Game Designer") */
  agentType?: string;
}

export interface AIBackend {
  id: string;
  name: string;
  command: string;
  buildArgs(prompt: string, opts: BuildArgsOpts): string[];
  /** Extra env vars to delete before spawning (e.g. CLAUDECODE) */
  deleteEnv?: string[];
  /** Whether this backend accepts stdin messages while running */
  supportsStdin?: boolean;
}
