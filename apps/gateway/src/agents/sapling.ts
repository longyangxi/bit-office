import type { AIBackend } from "@bit-office/orchestrator";

export function createSaplingAgent(): AIBackend {
  return {
    id: "sapling",
    name: "Sapling",
    command: "sp",
    instructionPath: "SAPLING.md",
    stability: "experimental",
    guardType: "none",             // .sapling/guards.json exists but not deployed by us
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: true,
    buildArgs(prompt, opts) {
      const args = ["run"];
      if (opts.model) args.push("--model", opts.model);
      args.push("--json", prompt);
      return args;
    },
  };
}
