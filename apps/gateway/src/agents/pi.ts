import type { AIBackend } from "@bit-office/orchestrator";

export function createPiAgent(): AIBackend {
  return {
    id: "pi",
    name: "Pi",
    command: "pi",
    instructionPath: ".claude/CLAUDE.md",  // Pi reads .claude/CLAUDE.md like Claude Code
    stability: "experimental",
    guardType: "none",             // .pi/extensions/ guard system exists but not deployed by us
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  };
}
