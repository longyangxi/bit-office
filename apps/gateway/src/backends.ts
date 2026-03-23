import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { AIBackend } from "@bit-office/orchestrator";

const isRoot = process.getuid?.() === 0;

/**
 * When running as root, --dangerously-skip-permissions is blocked by Claude Code.
 * Instead, configure ~/.claude/settings.json to allow all tool permissions.
 */
function ensureClaudeSettingsForRoot() {
  if (!isRoot) return;
  const claudeDir = path.join(homedir(), ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  const requiredAllow = [
    "Bash", "Read", "Write", "Edit", "MultiEdit",
    "Glob", "Grep", "WebFetch", "TodoRead", "TodoWrite", "Agent",
  ];
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
    // bypassPermissions via settings.json — equivalent to --dangerously-skip-permissions
    settings.defaultMode = "bypassPermissions";
    const perms = (settings.permissions ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(perms.allow) ? perms.allow as string[] : [];
    const merged = [...new Set([...existing, ...requiredAllow])];
    perms.allow = merged;
    settings.permissions = perms;
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    console.log("[backends] Running as root — configured Claude Code settings.json to allow all permissions");
  } catch (err) {
    console.warn("[backends] Failed to configure Claude settings for root:", err);
  }
}

ensureClaudeSettingsForRoot();

const backends: AIBackend[] = [
  // ── Stable backends ───────────────────────────────────────────
  {
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
    deleteEnv: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  },
  {
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
  },

  // ── Beta backends ─────────────────────────────────────────────
  {
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
  },

  // ── Experimental backends ─────────────────────────────────────
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

const backendMap = new Map<string, AIBackend>(backends.map((b) => [b.id, b]));

export function getBackend(id: string): AIBackend | undefined {
  return backendMap.get(id);
}

export function getAllBackends(): AIBackend[] {
  return backends;
}

/**
 * Version-probe commands for backends with ambiguous binary names.
 * Maps backend id → shell command that succeeds ONLY if the real CLI is installed.
 * Backends not listed here use plain `which <command>` (their names are distinctive enough).
 */
const VERSION_PROBES: Record<string, string> = {
  // "agent" is too generic — verify it's actually Cursor's CLI
  cursor: "agent --version 2>&1 | grep -iq cursor",
  // "pi" collides with math utilities, coreutils, etc.
  pi: "pi --version 2>&1 | grep -iq pi",
  // "sp" collides with Sapling SCM and other tools
  sapling: "sp --version 2>&1 | grep -iq sapling",
};

/** Check which AI CLI tools are installed on this machine.
 *  Also resolves each detected backend's command to its absolute path
 *  so that spawn() works even if the child process env has a different PATH. */
export function detectBackends(): string[] {
  const detected: string[] = [];
  for (const backend of backends) {
    try {
      const probe = VERSION_PROBES[backend.id];
      if (probe) {
        // Ambiguous name — run version probe to verify identity
        execSync(probe, { stdio: "ignore", timeout: 5000 });
      } else {
        // Distinctive name — `which` is sufficient
        execSync(`which ${backend.command}`, { stdio: "ignore", timeout: 3000 });
      }
      // Resolve absolute path so spawn() doesn't depend on child env PATH
      try {
        const absPath = execSync(`which ${backend.command}`, { encoding: "utf-8", timeout: 3000 }).trim();
        if (absPath && absPath.startsWith("/")) {
          backend.command = absPath;
          console.log(`[backends] ${backend.id}: resolved to ${absPath}`);
        }
      } catch { /* keep relative command as fallback */ }
      detected.push(backend.id);
    } catch {
      // not installed or wrong binary
    }
  }
  return detected;
}
