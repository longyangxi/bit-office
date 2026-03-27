import type { AIBackend } from "@bit-office/orchestrator";

export function createGeminiAgent(): AIBackend {
  return {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    instructionPath: "GEMINI.md",
    stability: "beta",
    guardType: "flag",             // --sandbox flag
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt) {
      return ["-p", prompt, "--yolo"];
    },
  };
}
