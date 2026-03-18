"use client";

import type { TeamChatMessage } from "@/store/office-store";
import SpriteAvatar from "./SpriteAvatar";
import ExpandableText from "./ExpandableText";

import { TERM_SEM_BLUE, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SURFACE } from "./termTheme";

export function getTeamMsgColors(): Record<string, { bg: string; border: string; label: string }> {
  return {
    delegation: { bg: TERM_SURFACE, border: TERM_SEM_BLUE, label: "Delegated" },
    result: { bg: TERM_SURFACE, border: TERM_SEM_GREEN, label: "Result" },
    status: { bg: TERM_SURFACE, border: TERM_SEM_YELLOW, label: "Status" },
  };
}
export const TEAM_MSG_COLORS = getTeamMsgColors();

/** Shared card component for team activity messages (used by both toast and log) */
function TeamActivityCard({ msg, agents, assetsReady, maxChars = 150, shadow, expandable = false }: {
  msg: TeamChatMessage;
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
  maxChars?: number;
  shadow?: boolean;
  expandable?: boolean;
}) {
  const cfg = TEAM_MSG_COLORS[msg.messageType] ?? TEAM_MSG_COLORS.status;
  const fromAgent = agents.get(msg.fromAgentId);
  const toAgent = msg.toAgentId ? agents.get(msg.toAgentId) : undefined;
  const msgText = msg.message ?? "";

  return (
    <div style={{
      padding: "8px 10px",
      backgroundColor: cfg.bg, borderLeft: `2px solid ${cfg.border}`,
      border: `1px solid ${cfg.border}40`,
      boxShadow: shadow ? "0 2px 12px rgba(0,0,0,0.5)" : undefined,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {fromAgent?.palette !== undefined && (
          <SpriteAvatar palette={fromAgent.palette} zoom={1} ready={assetsReady} />
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
          {msg.fromAgentName ?? msg.fromAgentId}
        </span>
        {msg.toAgentName && (
          <>
            <span style={{ fontSize: 11, color: "#6a5848" }}>&rarr;</span>
            {toAgent?.palette !== undefined && (
              <SpriteAvatar palette={toAgent.palette} zoom={1} ready={assetsReady} />
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
              {msg.toAgentName}
            </span>
          </>
        )}
        <span style={{
          marginLeft: "auto", fontSize: 9, padding: "1px 4px",
          backgroundColor: cfg.border + "20", color: cfg.border,
          border: `1px solid ${cfg.border}40`, fontFamily: "monospace",
        }}>
          {cfg.label}
        </span>
      </div>
      {expandable
        ? <ExpandableText text={msgText} maxChars={maxChars} maxHeight={80} />
        : (
          <div style={{
            fontSize: 12, color: "#b09878", wordBreak: "break-word",
            maxHeight: 80, overflow: "hidden", fontFamily: "monospace",
          }}>
            {msgText.slice(0, maxChars)}{msgText.length > maxChars ? "..." : ""}
          </div>
        )
      }
    </div>
  );
}

export default TeamActivityCard;
