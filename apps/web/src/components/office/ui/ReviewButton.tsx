"use client";

import { useState, useEffect, useRef } from "react";
import type { ChatMessage } from "@/store/office-store";
import { TERM_FONT, TERM_SIZE, TERM_DIM, TERM_TEXT, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_SEM_GREEN } from "./termTheme";
import { BACKEND_OPTIONS } from "./office-constants";
import { reviewBtnStyle } from "./messageBubbleStyles";

/** Inline backend picker for review button */
export function ReviewButton({ result, onReview, detectedBackends }: {
  result: NonNullable<ChatMessage["result"]>;
  onReview: (result: NonNullable<ChatMessage["result"]>, backend?: string) => void;
  detectedBackends: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="term-btn"
        onClick={() => setOpen(!open)}
        style={reviewBtnStyle}
      >review {open ? "\u25B4" : "\u25BE"}</button>
      {open && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4, zIndex: 50,
          backgroundColor: TERM_PANEL, border: `1px solid ${TERM_BORDER}`,
          minWidth: 150, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "4px 8px", color: TERM_DIM, fontFamily: TERM_FONT, fontSize: TERM_SIZE, letterSpacing: "0.05em", borderBottom: `1px solid ${TERM_BORDER}` }}>
            SELECT AI
          </div>
          {BACKEND_OPTIONS.map((b) => {
            const available = detectedBackends.length === 0 || detectedBackends.includes(b.id);
            return (
              <button
                key={b.id}
                disabled={!available}
                onClick={() => { if (!available) return; setOpen(false); onReview(result, b.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "6px 10px", border: "none",
                  cursor: available ? "pointer" : "not-allowed",
                  backgroundColor: "transparent", textAlign: "left",
                  fontFamily: TERM_FONT, fontSize: TERM_SIZE,
                  color: available ? TERM_TEXT : TERM_DIM,
                  opacity: available ? 1 : 0.4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = TERM_SURFACE; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  backgroundColor: available ? TERM_SEM_GREEN : TERM_DIM,
                  flexShrink: 0,
                }} />
                <span>{b.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
