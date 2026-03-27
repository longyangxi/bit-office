import type { AIBackend } from "@bit-office/orchestrator";
import { probeAndResolve } from "./common.js";
import { createClaudeCodeAgent } from "./claude-code.js";
import { createCodexAgent } from "./codex.js";
import { createGeminiAgent } from "./gemini.js";
import { createCopilotAgent } from "./copilot.js";
import { createCursorAgent } from "./cursor.js";
import { createAiderAgent } from "./aider.js";
import { createOpenCodeAgent } from "./opencode.js";
import { createPiAgent } from "./pi.js";
import { createSaplingAgent } from "./sapling.js";

const AGENT_FACTORIES: Array<() => AIBackend> = [
  createClaudeCodeAgent,
  createCodexAgent,
  createGeminiAgent,
  createCopilotAgent,
  createCursorAgent,
  createAiderAgent,
  createOpenCodeAgent,
  createPiAgent,
  createSaplingAgent,
];

/** Create all agent instances */
export function getAllAgents(): AIBackend[] {
  return AGENT_FACTORIES.map(f => f());
}

/** Detect installed backends and return only those available */
export function detectAndCreateAgents(): { agents: AIBackend[]; detected: string[] } {
  const all = getAllAgents();
  const detected: string[] = [];
  const available: AIBackend[] = [];

  for (const agent of all) {
    const resolved = probeAndResolve(agent.id, agent.command);
    if (resolved) {
      (agent as any).command = resolved;
      detected.push(agent.id);
      available.push(agent);
      console.log(`[agents] ${agent.id}: resolved to ${resolved}`);
    }
  }

  return { agents: available, detected };
}
