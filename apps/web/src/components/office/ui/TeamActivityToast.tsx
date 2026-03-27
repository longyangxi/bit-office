"use client";

import { useState, useEffect, useRef } from "react";
import type { TeamChatMessage } from "@/store/office-store";
import TeamActivityCard from "./TeamActivityCard";

/** Toast notifications for team activity — slides in at top-right of game stage */
function TeamActivityToast({ messages, agents, assetsReady }: {
  messages: TeamChatMessage[];
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
}) {
  const [visible, setVisible] = useState<TeamChatMessage | null>(null);
  const [sliding, setSliding] = useState(false);
  const lastCountRef = useRef(messages.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (messages.length > lastCountRef.current) {
      const newest = messages[messages.length - 1];
      if (newest && newest.fromAgentId) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setVisible(newest);
        setSliding(true);
        timerRef.current = setTimeout(() => {
          setSliding(false);
          timerRef.current = setTimeout(() => setVisible(null), 400);
        }, 5000);
      }
    }
    lastCountRef.current = messages.length;
  }, [messages.length, messages]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, zIndex: 20,
      width: "clamp(240px, 30vw, 360px)", maxWidth: "40vw",
      transform: sliding ? "translateX(0)" : "translateX(calc(100% + 16px))",
      opacity: sliding ? 1 : 0,
      transition: "transform 0.35s ease, opacity 0.35s ease",
      pointerEvents: "none",
    }}>
      <TeamActivityCard msg={visible} agents={agents} assetsReady={assetsReady} maxChars={120} shadow />
    </div>
  );
}

export default TeamActivityToast;
