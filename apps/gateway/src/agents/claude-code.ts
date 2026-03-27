import type { AIBackend } from "@bit-office/orchestrator";
import { isRoot, ensureClaudeSettingsForRoot } from "./common.js";

ensureClaudeSettingsForRoot();

export function createClaudeCodeAgent(): AIBackend {
  return {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    supportsStdin: true,
    instructionPath: ".claude/CLAUDE.md",
    stability: "stable",
    guardType: "hooks",
    supportsResume: true,
    supportsAgentType: true,
    supportsNativeWorktree: true,
    supportsStructuredOutput: true,
    deleteEnv: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    buildArgs(prompt, opts) {
      const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
      if (!isRoot) args.push("--dangerously-skip-permissions");
      if (!opts.skipResume) {
        if (opts.resumeSessionId) {
          args.push("--resume", opts.resumeSessionId);
        } else if (opts.continue) {
          args.push("--continue");
        }
      }
      if (opts.noTools) args.push("--tools", "");
      if (opts.model) args.push("--model", opts.model);
      if (opts.agentType) args.push("--agent", opts.agentType);
      if (opts.worktree) args.push("--worktree");
      return args;
    },
  };
}
