import type { AIBackend } from "@bit-office/orchestrator";

export function createCursorAgent(): AIBackend {
  return {
    id: "cursor",
    name: "Cursor CLI",
    command: "agent",              // Cursor's CLI binary is "agent", not "cursor"
    instructionPath: ".cursor/rules/instructions.md",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.fullAccess) args.push("--yolo");
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  };
}
