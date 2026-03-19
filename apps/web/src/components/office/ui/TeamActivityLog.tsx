"use client";

import { useState, useEffect, useRef } from "react";
import { TERM_DIM, TERM_BORDER_DIM, TERM_SEM_RED } from "./termTheme";
import type { TeamChatMessage } from "@/store/office-store";
import TeamActivityCard from "./TeamActivityCard";

function TeamActivityLog({ messages, agents, assetsReady, onClear }: {
  messages: TeamChatMessage[];
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
  onClear?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (collapsed) return;
    const el = endRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages.length, collapsed]);

  return (
    <div style={{
      borderTop: "1px solid #152515",
      padding: "6px 0",
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: "4px 12px 6px",
          fontSize: 10, color: "#6a5848", fontFamily: "monospace",
          letterSpacing: "0.05em", textTransform: "uppercase",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ width: 10, textAlign: "center" }}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        Activity ({messages.length})
        {onClear && (
          <span
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            style={{
              marginLeft: "auto", fontSize: 9, padding: "1px 5px",
              color: TERM_DIM, border: `1px solid ${TERM_BORDER_DIM}80`,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TERM_SEM_RED; e.currentTarget.style.borderColor = `${TERM_SEM_RED}80`; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; e.currentTarget.style.borderColor = `${TERM_BORDER_DIM}80`; }}
          >CLEAR</span>
        )}
      </div>
      {!collapsed && (
        <div data-scrollbar style={{ overflowY: "auto", maxHeight: "30vh", padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {messages.map((msg, i) => {
            if (!msg || !msg.fromAgentId) return null;
            return (
              <TeamActivityCard key={msg.id ?? `tc-${i}`} msg={msg} agents={agents} assetsReady={assetsReady} expandable />
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

export default TeamActivityLog;
