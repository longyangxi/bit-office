import type { AgentStatus } from "./types.js";

export interface AgentCandidate {
  agentId: string;
  role: string;
  status: AgentStatus;
  isTeamLead: boolean;
}

/**
 * Select the best available agent for a task based on role matching.
 *
 * Priority:
 * 1. Idle agent with exact role match (never Team Lead)
 * 2. Idle agent with partial role match
 * 3. Any idle non-lead agent (fallback, only if no agent in the pool has the role at all)
 * 4. null (no agent available or role is known but no eligible idle agent)
 */
export function selectAgent(agents: AgentCandidate[], requestedRole: string): string | null {
  const eligible = agents.filter(a => !a.isTeamLead && a.status === "idle");

  // Exact role match among eligible
  const exact = eligible.find(a =>
    a.role.toLowerCase() === requestedRole.toLowerCase()
  );
  if (exact) return exact.agentId;

  // Partial match among eligible
  const partial = eligible.find(a =>
    a.role.toLowerCase().includes(requestedRole.toLowerCase()) ||
    requestedRole.toLowerCase().includes(a.role.toLowerCase())
  );
  if (partial) return partial.agentId;

  // Check if the role is known to any agent in the full pool (including busy/leads).
  // If the role IS known but no eligible agent is available, return null rather than
  // assigning the task to a wrong-role agent.
  const roleIsKnown = agents.some(a =>
    a.role.toLowerCase() === requestedRole.toLowerCase() ||
    a.role.toLowerCase().includes(requestedRole.toLowerCase()) ||
    requestedRole.toLowerCase().includes(a.role.toLowerCase())
  );
  if (roleIsKnown) return null;

  // Role is entirely unrecognised — fall back to any idle non-lead agent.
  return eligible[0]?.agentId ?? null;
}
