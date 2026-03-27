import type { AIBackend } from "@bit-office/orchestrator";

export function createAiderAgent(): AIBackend {
  return {
    id: "aider",
    name: "Aider",
    command: "aider",
    instructionPath: ".aider.conf.yml",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt) {
      return ["--message", prompt, "--yes", "--no-pretty", "--no-git"];
    },
  };
}
