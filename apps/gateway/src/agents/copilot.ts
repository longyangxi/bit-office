import type { AIBackend } from "@bit-office/orchestrator";

export function createCopilotAgent(): AIBackend {
  return {
    id: "copilot",
    name: "GitHub Copilot",
    command: "copilot",
    instructionPath: ".github/copilot-instructions.md",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.fullAccess) args.push("--allow-all-tools");
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  };
}
