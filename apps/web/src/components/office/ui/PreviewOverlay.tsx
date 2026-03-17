"use client";

import { useState, useEffect } from "react";
import { RATING_DIMENSIONS } from "./office-constants";
import type { Ratings } from "./office-constants";

function StarRow({ label, icon, value, onChange }: {
  label: string; icon: string; value: number; onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24 }}>
      <span style={{ width: 100, fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
        {icon} {label}
      </span>
      <div style={{ display: "flex", gap: 2 }} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            onClick={() => onChange(n === value ? 0 : n)}
            onMouseEnter={() => setHover(n)}
            style={{
              cursor: "pointer", fontSize: 14, lineHeight: 1,
              color: n <= (hover || value) ? "#e8b040" : "rgba(255,255,255,0.15)",
              transition: "color 0.1s",
            }}
          >{"\u2605"}</span>
        ))}
      </div>
      {value > 0 && (
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{value}/5</span>
      )}
    </div>
  );
}

function RatingPopup({ onSubmit, onSkip, initialRatings }: { onSubmit: (ratings: Record<string, number>) => void; onSkip: () => void; initialRatings?: Ratings }) {
  const [ratings, setRatings] = useState<Ratings>(initialRatings ?? {});
  const hasRatings = Object.values(ratings).some((v) => v && v > 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      backgroundColor: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onSkip}>
      <div style={{
        backgroundColor: "#0a0e0a", padding: "22px 20px",
        border: "2px solid rgba(232,176,64,0.4)",
        boxShadow: "0 0 40px rgba(200,155,48,0.1)",
        width: 280,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: "#e8b040", fontFamily: "monospace", fontWeight: 600, marginBottom: 14, textAlign: "center" }}>
          Rate this project
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {RATING_DIMENSIONS.map((d) => (
            <StarRow
              key={d.key}
              label={d.label}
              icon={d.icon}
              value={ratings[d.key] ?? 0}
              onChange={(v) => setRatings((prev) => ({ ...prev, [d.key]: v }))}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
          <button
            onClick={onSkip}
            style={{
              padding: "6px 16px", border: "1px solid rgba(255,255,255,0.1)",
              background: "none", color: "rgba(255,255,255,0.35)",
              fontSize: 11, fontFamily: "monospace", cursor: "pointer",
            }}
          >Skip</button>
          <button
            onClick={() => {
              if (!hasRatings) return;
              const filtered = Object.fromEntries(
                Object.entries(ratings).filter(([, v]) => v && v > 0),
              );
              onSubmit(filtered);
            }}
            disabled={!hasRatings}
            style={{
              padding: "6px 16px", border: "1px solid rgba(72,204,106,0.3)",
              background: hasRatings ? "rgba(72,204,106,0.12)" : "rgba(255,255,255,0.03)",
              color: hasRatings ? "#48cc6a" : "rgba(255,255,255,0.2)",
              fontSize: 11, fontFamily: "monospace", cursor: hasRatings ? "pointer" : "default",
            }}
          >Submit</button>
        </div>
      </div>
    </div>
  );
}

function PreviewOverlay({ url, onClose, savedRatings, submitted, onRate }: {
  url: string; onClose: () => void;
  savedRatings: Ratings; submitted: boolean;
  onRate: (ratings: Record<string, number>) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showRating, setShowRating] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setStatus("loading");
    const timer = setTimeout(() => setStatus("ready"), 3000);
    return () => clearTimeout(timer);
  }, [url]);

  const handleClose = () => {
    setClosing(true);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(0,0,0,0.85)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        height: 40, display: "flex", alignItems: "center",
        padding: "0 12px", backgroundColor: "#0a0e0a", gap: 8,
      }}>
        <span style={{
          flex: 1, color: "#888", fontSize: 14,
          fontFamily: "monospace", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{url}</span>
        <button
          onClick={() => setShowRating(true)}
          style={{
            background: submitted ? "rgba(72,204,106,0.1)" : "none",
            border: submitted ? "1px solid rgba(72,204,106,0.3)" : "1px solid rgba(232,176,64,0.3)",
            color: submitted ? "#48cc6a" : "#e8b040", fontSize: 11, cursor: "pointer",
            padding: "2px 10px", fontFamily: "monospace",
          }}
        >{submitted ? "Rated \u2713" : "\u2605 Rate"}</button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#e8b040", fontSize: 12, textDecoration: "none",
            padding: "2px 8px", border: "1px solid #3d2d10", fontFamily: "monospace",
          }}
        >Open in tab</a>
        <button
          onClick={handleClose}
          style={{
            background: "none", border: "1px solid #444",
            color: "#aaa", fontSize: 17, cursor: "pointer",
            borderRadius: 6, width: 28, height: 28,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >{"\u2715"}</button>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        {status === "loading" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16,
          }}>
            <div style={{
              width: 32, height: 32, border: "3px solid #333",
              borderTopColor: "#818cf8", borderRadius: "50%",
              animation: "preview-spin 0.8s linear infinite",
            }} />
            <div style={{ color: "#888", fontSize: 15 }}>Starting server...</div>
            <style>{`@keyframes preview-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        {status === "ready" && (
          <iframe
            src={url}
            style={{
              width: "100%", height: "100%", border: "none",
              // Hide iframe when rating popup is visible — iframes can render above overlays in some browsers
              ...(closing || showRating ? { pointerEvents: "none" as const, visibility: "hidden" as const } : {}),
            }}
            onLoad={(e) => (e.target as HTMLIFrameElement).focus()}
          />
        )}
      </div>
      {/* Rating popup — triggered by Rate button or on close */}
      {(showRating || closing) && (
        <RatingPopup
          initialRatings={savedRatings}
          onSubmit={(r) => {
            onRate(r);
            setShowRating(false);
            if (closing) onClose();
          }}
          onSkip={() => {
            setShowRating(false);
            if (closing) onClose();
          }}
        />
      )}
    </div>
  );
}

export default PreviewOverlay;
