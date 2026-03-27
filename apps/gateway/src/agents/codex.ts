import type { AIBackend } from "@bit-office/orchestrator";
import { isRoot } from "./common.js";

export function createCodexAgent(): AIBackend {
  return {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    instructionPath: "AGENTS.md",
    stability: "stable",
    guardType: "sandbox",          // OS-level Seatbelt (macOS) / Landlock (Linux)
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      if (opts.fullAccess && !isRoot) {
        return ["exec", prompt, "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"];
      }
      return ["exec", prompt, "--full-auto", "--skip-git-repo-check"];
    },
  };
}
