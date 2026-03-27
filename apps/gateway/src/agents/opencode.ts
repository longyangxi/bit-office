import type { AIBackend } from "@bit-office/orchestrator";

export function createOpenCodeAgent(): AIBackend {
  return {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    instructionPath: "AGENTS.md",  // Same convention as Codex
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: true,
    buildArgs(prompt) {
      return ["run", prompt, "--format", "json"];
    },
  };
}
