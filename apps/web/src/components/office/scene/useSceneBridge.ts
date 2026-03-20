"use client";

import { useEffect, useRef } from "react";
import { useOfficeStore } from "@/store/office-store";
import type { SceneAdapter, BubbleType } from "./SceneAdapter";

import { TERM_SEM_BLUE, TERM_SEM_YELLOW, TERM_DIM } from "../ui/termTheme";

/** Agent type colors for name badges */
function getAgentTypeColors() {
  return {
    external: TERM_SEM_BLUE,
    team: TERM_SEM_YELLOW,
    normal: TERM_DIM,
  };
}
const AGENT_TYPE_COLORS = getAgentTypeColors();

function getAgentLabel(agent: {
  name: string;
  isExternal?: boolean;
  pid?: number;
  teamId?: string;
}): { label: string; color: string } {
  if (agent.isExternal) {
    return { label: `${agent.pid ?? "?"}`, color: AGENT_TYPE_COLORS.external };
  }
  const short = agent.name.split(/[\s(]/)[0];
  const color = agent.teamId ? AGENT_TYPE_COLORS.team : AGENT_TYPE_COLORS.normal;
  return { label: short, color };
}

/** Derive which bubble to show from the agent's store state */
function deriveBubble(agent: { pendingApproval: unknown; status: string }): BubbleType | null {
  if (agent.pendingApproval) return "permission";
  if (agent.status === "working") return "working";
  if (agent.status === "done" || agent.status === "error") return "waiting";
  return null;
}

/**
 * Bridges the Zustand office store to any SceneAdapter implementation.
 * Handles agent lifecycle, status/bubble sync, speech bubbles, and selection.
 */
export function useSceneBridge(
  adapter: SceneAdapter | null,
  selectedAgent: string | null,
): void {
  const knownAgentsRef = useRef<Set<string>>(new Set());
  const prevMsgCountRef = useRef<Map<string, number>>(new Map());
  const prevLogLineRef = useRef<Map<string, string | null>>(new Map());
  const prevTeamMsgCountRef = useRef(0);

  // Seed existing agents when adapter first becomes available
  useEffect(() => {
    if (!adapter) return;

    const state = useOfficeStore.getState();
    for (const [agentId, agent] of state.agents) {
      const { label, color: labelColor } = getAgentLabel(agent);
      adapter.addAgent(agentId, {
        name: agent.name,
        label,
        labelColor,
        isExternal: !!agent.isExternal,
        palette: agent.palette,
      });
      adapter.updateAgent(agentId, agent.status, deriveBubble(agent), !!agent.teamId);
      knownAgentsRef.current.add(agentId);
      prevMsgCountRef.current.set(agentId, agent.messages.length);
      prevLogLineRef.current.set(agentId, state.agentLogLines.get(agentId) ?? agent.lastLogLine ?? null);
    }
    prevTeamMsgCountRef.current = state.teamMessages.length;

    return () => {
      knownAgentsRef.current.clear();
      prevMsgCountRef.current.clear();
      prevLogLineRef.current.clear();
      prevTeamMsgCountRef.current = 0;
    };
  }, [adapter]);

  // Subscribe to Zustand store changes
  useEffect(() => {
    if (!adapter) return;

    const unsub = useOfficeStore.subscribe((state) => {
      const currentIds = new Set(state.agents.keys());

      for (const [agentId, agent] of state.agents) {
        if (!knownAgentsRef.current.has(agentId)) {
          const { label, color: labelColor } = getAgentLabel(agent);
          adapter.addAgent(agentId, {
            name: agent.name,
            label,
            labelColor,
            isExternal: !!agent.isExternal,
            palette: agent.palette,
          });
          knownAgentsRef.current.add(agentId);
        }

        // Team members keep their seat when inactive (done/idle), solo agents release it
        adapter.updateAgent(agentId, agent.status, deriveBubble(agent), !!agent.teamId);

        // Detect new agent messages -> speech bubble
        const prevCount = prevMsgCountRef.current.get(agentId) ?? 0;
        const curCount = agent.messages.length;
        if (curCount > prevCount) {
          const lastMsg = agent.messages[curCount - 1];
          if (lastMsg && lastMsg.role !== "user") {
            adapter.showSpeechBubble(agentId, lastMsg.text);
          }
        }
        prevMsgCountRef.current.set(agentId, curCount);

        // Detect log output -> speech bubble (read from separated agentLogLines)
        const prevLog = prevLogLineRef.current.get(agentId);
        const curLog = state.agentLogLines.get(agentId) ?? agent.lastLogLine;
        if (curLog && curLog !== prevLog) {
          adapter.showSpeechBubble(agentId, curLog);
        }
        prevLogLineRef.current.set(agentId, curLog);
      }

      // Team chat messages -> speech bubble on sender
      const prevTeamCount = prevTeamMsgCountRef.current;
      if (state.teamMessages.length > prevTeamCount) {
        for (let i = prevTeamCount; i < state.teamMessages.length; i++) {
          const tm = state.teamMessages[i];
          const toName = tm.toAgentName;
          const text = toName ? `${toName}: ${tm.message}` : tm.message;
          adapter.showSpeechBubble(tm.fromAgentId, text);
        }
      }
      prevTeamMsgCountRef.current = state.teamMessages.length;

      for (const agentId of knownAgentsRef.current) {
        if (!currentIds.has(agentId)) {
          adapter.removeAgent(agentId);
          knownAgentsRef.current.delete(agentId);
          prevMsgCountRef.current.delete(agentId);
          prevLogLineRef.current.delete(agentId);
        }
      }
    });
    return unsub;
  }, [adapter]);

  // Sync selection
  useEffect(() => {
    adapter?.selectAgent(selectedAgent);
  }, [adapter, selectedAgent]);
}
