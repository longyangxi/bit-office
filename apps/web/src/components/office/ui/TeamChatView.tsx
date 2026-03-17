"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { TeamChatMessage } from "@/store/office-store";
import SpriteAvatar from "./SpriteAvatar";
import ExpandableText from "./ExpandableText";

const TEAM_MSG_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  delegation: { bg: "#182844", border: "#5aacff", label: "Delegated" },
  result: { bg: "#143822", border: "#48cc6a", label: "Result" },
  status: { bg: "#261a00", border: "#e8b040", label: "Status" },
};

function TeamChatView({ messages, agents, assetsReady }: {
  messages: TeamChatMessage[];
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  // Track scroll position — updated on user/programmatic scroll events.
  // This captures the "before new content" state that useLayoutEffect reads.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll to bottom synchronously after DOM commit (before paint / before scroll events).
  // wasAtBottom.current still reflects the state BEFORE React added the new message,
  // so it won't be fooled by the increased scrollHeight.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && wasAtBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // MutationObserver for streaming text / typewriter reveals within existing messages.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (wasAtBottom.current) {
            el.scrollTop = el.scrollHeight;
          }
        });
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  if (messages.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "#5a4838", padding: 30, fontSize: 12, fontFamily: "monospace" }}>
        No team activity yet. Hire a team and send a task to the Team Lead.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      {messages.map((msg, i) => {
        if (!msg || !msg.fromAgentId) return null;
        const cfg = TEAM_MSG_COLORS[msg.messageType] ?? TEAM_MSG_COLORS.status;
        const fromAgent = agents.get(msg.fromAgentId);
        const toAgent = msg.toAgentId ? agents.get(msg.toAgentId) : undefined;
        const msgText = msg.message ?? "";
        return (
          <div key={msg.id ?? `tc-${i}`} style={{
            padding: "8px 10px",
            backgroundColor: cfg.bg, borderLeft: `2px solid ${cfg.border}`,
            border: `1px solid ${cfg.border}40`,
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
            <ExpandableText text={msgText} maxChars={300} maxHeight={120} />
            <div style={{ fontSize: 10, color: "#5a4838", marginTop: 4, fontFamily: "monospace" }}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TeamChatView;
