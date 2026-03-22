"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { TERM_BG, TERM_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW } from "./termTheme";
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
  const [showRating, setShowRating] = useState(false);
  const [closing, setClosing] = useState(false);
  const isTauri = useRef(typeof window !== "undefined" && window.location.protocol === "tauri:");
  // Tauri retry: mount/unmount iframe cycle to force WebKit fresh requests.
  // "mount" = iframe rendered, "unmount" = iframe removed (forces fresh load on next mount).
  const [tauriMounted, setTauriMounted] = useState(false);
  const tauriLoadedRef = useRef(false);
  const tauriRetryRef = useRef(0);
  const maxTauriRetries = 15; // ~30s worst case (2s each cycle)

  const handleTauriLoad = useCallback(() => {
    tauriLoadedRef.current = true;
  }, []);

  // Tauri retry loop: mount iframe → wait 2s for onLoad → if no onLoad, unmount
  // and remount to force WebKit to make a fresh request (avoids cached errors).
  useEffect(() => {
    if (!isTauri.current || status !== "ready") return;
    if (tauriLoadedRef.current) return; // already loaded, stop retrying
    const t = setTimeout(() => {
      if (tauriLoadedRef.current) return;
      tauriRetryRef.current++;
      if (tauriRetryRef.current >= maxTauriRetries) {
        tauriLoadedRef.current = true; // stop cycling
        return;
      }
      // Unmount iframe, then remount after a brief gap
      setTauriMounted(false);
      setTimeout(() => setTauriMounted(true), 200);
    }, 2000);
    return () => clearTimeout(t);
  }, [status, tauriMounted]);

  // Poll the preview URL until it responds instead of hardcoded delay.
  // Handles slow npx serve cold starts (first run downloads the package).
  // In Tauri (tauri:// protocol), fetch to http://localhost always fails due to
  // cross-protocol restrictions. We skip fetch and use an iframe mount/unmount
  // retry cycle — each mount forces WebKit to make a fresh request.
  useEffect(() => {
    if (isTauri.current) {
      tauriLoadedRef.current = false;
      tauriRetryRef.current = 0;
      setStatus("loading");
      // Initial delay before first mount attempt
      const t = setTimeout(() => {
        setStatus("ready");
        setTauriMounted(true);
      }, 1500);
      return () => clearTimeout(t);
    }

    setStatus("loading");
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds max (500ms interval)

    const poll = () => {
      if (cancelled) return;
      attempts++;
      fetch(url, { mode: "no-cors" })
        .then(() => {
          if (!cancelled) setStatus("ready");
        })
        .catch(() => {
          if (!cancelled && attempts < maxAttempts) {
            setTimeout(poll, 500);
          } else if (!cancelled) {
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
        {/* Mount iframe after readiness confirmed. In Tauri, tauriMounted controls
            a mount/unmount cycle that forces WebKit to make fresh requests on retry. */}
        {status === "ready" && (isTauri.current ? tauriMounted : true) && (
          <iframe
            src={url}
            onLoad={isTauri.current ? handleTauriLoad : undefined}
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
