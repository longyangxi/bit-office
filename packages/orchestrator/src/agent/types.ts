// packages/orchestrator/src/agent/types.ts

/**
 * AgentPlugin — pluggable AI backend adapter.
 * Superset of the old AIBackend interface, adding activity detection,
 * workspace hooks, and session info extraction.
 */

// Re-export existing types for backward compatibility
export type { BuildArgsOpts } from "../ai-backend.js";

/** Stability level of a backend adapter */
export type BackendStability = "stable" | "beta" | "experimental";

/** Guard mechanism supported by the backend */
export type GuardType = "hooks" | "sandbox" | "flag" | "none";

/** Activity state as detected by the agent plugin */
export type ActivityState =
  | "active"       // agent is processing (thinking, writing code)
  | "ready"        // agent finished its turn, waiting for input
  | "idle"         // agent has been inactive for a while
  | "waiting_input" // agent is asking a question / permission prompt
  | "exited";      // agent process is no longer running

/** Session reference for plugin queries */
export interface AgentSessionRef {
  agentId: string;
  workspacePath: string | null;
  /** From AgentSession.pid getter */
  pid: number | undefined;
  /** Timestamp of last stdout activity */
  lastOutputAt: number | undefined;
}

/** Extracted session info */
export interface AgentSessionInfo {
  summary: string | null;
  agentSessionId: string | null;
  cost?: { inputTokens: number; outputTokens: number };
}

/** Config for workspace hooks setup */
export interface WorkspaceHooksConfig {
  dataDir: string;
  sessionId?: string;
}

export interface AgentPlugin {
  /** Unique identifier: "claude-code", "codex", "gemini", etc. */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** CLI command to invoke */
  readonly command: string;
  /** Stability level */
  readonly stability: BackendStability;
  /** Security guard mechanism */
  readonly guardType: GuardType;

  /** Build CLI arguments for launching the agent */
  buildArgs(prompt: string, opts: import("../ai-backend.js").BuildArgsOpts): string[];

  /** Environment variables to delete before spawning */
  getCleanEnv?(): string[];

  /** Detect current activity state (optional — enables agent:stuck detection) */
  detectActivity?(session: AgentSessionRef): ActivityState | null;

  /** Extract session info: summary, cost, session ID (optional) */
  getSessionInfo?(session: AgentSessionRef): AgentSessionInfo | null;

  /** Set up agent-specific hooks/config in workspace (optional) */
  setupWorkspaceHooks?(workspacePath: string, config: WorkspaceHooksConfig): void;

  /** Get resume/restore command (optional) */
  getRestoreCommand?(session: AgentSessionRef): string[] | null;

  /** Capability flags */
  readonly capabilities: {
    stdin: boolean;
    resume: boolean;
    agentType: boolean;
    nativeWorktree: boolean;
    structuredOutput: boolean;
  };

  /** Path to instruction file within a worktree */
  readonly instructionPath?: string;

  // ── Backward compatibility with AIBackend ──
  /** @deprecated Use getCleanEnv() instead */
  readonly deleteEnv?: string[];
  /** @deprecated Use capabilities.stdin instead */
  readonly supportsStdin?: boolean;
  /** @deprecated Use capabilities.resume instead */
  readonly supportsResume?: boolean;
  /** @deprecated Use capabilities.agentType instead */
  readonly supportsAgentType?: boolean;
  /** @deprecated Use capabilities.nativeWorktree instead */
  readonly supportsNativeWorktree?: boolean;
  /** @deprecated Use capabilities.structuredOutput instead */
  readonly supportsStructuredOutput?: boolean;
}
