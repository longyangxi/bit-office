"use client";

import { useState, useEffect, useRef } from "react";
import { TERM_BG, TERM_BORDER, TERM_GREEN, TERM_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW } from "./termTheme";
import { RATING_DIMENSIONS } from "./office-constants";
import type { Ratings } from "./office-constants";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

function StarRow({ label, icon, value, onChange }: {
  label: string; icon: string; value: number; onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24 }}>
      <span style={{ width: 100, fontSize: 11, color: TERM_DIM, fontFamily: "monospace" }}>
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
              color: n <= (hover || value) ? TERM_SEM_YELLOW : "rgba(255,255,255,0.15)",
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
    <TermModal
      open={true}
      onClose={onSkip}
      maxWidth={280}
      title="Rate this project"
      footer={
        <>
          <TermButton variant="dim" onClick={onSkip} style={{ padding: "6px 16px", fontSize: 11 }}>Skip</TermButton>
          <TermButton
            variant="success"
            onClick={() => {
              if (!hasRatings) return;
              const filtered = Object.fromEntries(
                Object.entries(ratings).filter(([, v]) => v && v > 0),
              );
              onSubmit(filtered);
            }}
            disabled={!hasRatings}
            style={{ padding: "6px 16px", fontSize: 11 }}
          >Submit</TermButton>
        </>
      }
    >
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
    </TermModal>
  );
}

function PreviewOverlay({ url, onClose, savedRatings, submitted, onRate }: {
  url: string; onClose: () => void;
  savedRatings: Ratings; submitted: boolean;
  onRate: (ratings: Record<string, number>) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [pollInfo, setPollInfo] = useState("");
  const [showRating, setShowRating] = useState(false);
  const [closing, setClosing] = useState(false);
  const isTauri = useRef(typeof window !== "undefined" && window.location.protocol === "tauri:");

  // Poll the preview URL until it responds instead of hardcoded delay.
  // Handles slow npx serve cold starts (first run downloads the package).
  // In Tauri (tauri:// protocol), fetch to http://localhost always fails due to
  // cross-protocol restrictions. Instead we use a simple delay — the static
  // server is already running by the time the user clicks preview. The iframe
  // must NOT be mounted until status="ready" so WebKit loads it fresh.
  useEffect(() => {
    if (isTauri.current) {
      setStatus("loading");
      setPollInfo("tauri — waiting 2s for server");
      const t = setTimeout(() => {
        setPollInfo("tauri — ready");
        setStatus("ready");
      }, 2000);
      return () => clearTimeout(t);
    }

    setStatus("loading");
    setPollInfo("waiting...");
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds max (500ms interval)

    const poll = () => {
      if (cancelled) return;
      attempts++;
      setPollInfo(`poll #${attempts}/${maxAttempts} → ${url}`);
      fetch(url, { mode: "no-cors" })
        .then(() => {
          if (!cancelled) {
            setPollInfo(`ready after ${attempts} polls`);
            setStatus("ready");
          }
        })
        .catch((err) => {
          if (!cancelled && attempts < maxAttempts) {
            setPollInfo(`poll #${attempts} failed: ${err.message ?? "network error"}`);
            setTimeout(poll, 500);
          } else if (!cancelled) {
            // Timeout — show iframe anyway (server may respond to iframe but not fetch)
            setPollInfo(`timeout after ${attempts} polls — showing iframe anyway`);
            setStatus("ready");
          }
        });
    };
    // Start polling after a short initial delay (give spawn time to start)
    const initial = setTimeout(poll, 800);
    return () => { cancelled = true; clearTimeout(initial); };
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
        padding: "0 12px", backgroundColor: TERM_BG, gap: 8,
      }}>
        <span style={{
          flex: 1, color: "#888", fontSize: 14,
          fontFamily: "monospace", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{url}</span>
        <button
          onClick={() => setShowRating(true)}
          style={{
            background: submitted ? `${TERM_SEM_GREEN}18` : "none",
            border: submitted ? `1px solid ${TERM_SEM_GREEN}30` : `1px solid ${TERM_SEM_YELLOW}30`,
            color: submitted ? TERM_SEM_GREEN : TERM_SEM_YELLOW, fontSize: 11, cursor: "pointer",
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
      {/* Debug bar — shows polling status, target URL, and window origin */}
      <div style={{
        height: 22, padding: "0 12px", backgroundColor: "#1a1a2e",
        borderBottom: "1px solid #333", display: "flex", alignItems: "center",
        fontFamily: "monospace", fontSize: 10, color: "#888", gap: 12, overflow: "hidden",
      }}>
        <span style={{ color: status === "ready" ? "#4ade80" : "#f59e0b" }}>{status}</span>
        <span style={{ color: "#666", flexShrink: 0 }}>origin: {typeof window !== "undefined" ? window.location.origin : "?"}</span>
        <span style={{ color: "#666", flexShrink: 0 }}>host: {typeof window !== "undefined" ? window.location.hostname : "?"}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pollInfo}</span>
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
        {/* Only mount iframe after readiness confirmed (fetch poll or Tauri delay).
            Mounting too early causes WebKit to cache the connection-refused error. */}
        {status === "ready" && (
          <iframe
            src={url}
            style={{
              width: "100%", height: "100%", border: "none",
              // Hide iframe when rating popup is visible
              ...(closing || showRating
                ? { pointerEvents: "none" as const, visibility: "hidden" as const }
                : {}),
            }}
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
