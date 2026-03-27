"use client";

/**
 * ProjectRecap.tsx — "Share Recap" button + GIF generation UI.
 *
 * Two input modes:
 *   1. `data` prop — pre-built RecapData from a live RecapCollector (zero extraction cost)
 *   2. `archive` prop — raw ProjectArchive (will run extractRecapData on click)
 *
 * Rendering only happens when user clicks "Share Recap" — never during project execution.
 *
 * Accessibility:
 *   - All buttons meet 44×44px minimum touch target (WCAG 2.5.8)
 *   - Focus-visible outlines on all interactive elements (2px, high contrast)
 *   - aria-labels on icon-only buttons
 *   - Spinner announces loading state to screen readers
 *   - prefers-reduced-motion disables spinner animation
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { RecapData } from "./recap-data";
import { extractRecapData } from "./recap-data";
import { renderRecapFrames, FRAME_W, FRAME_H } from "./recap-renderer";
import { encodeGif } from "./gif-encoder";

export type ProjectRecapProps = {
  /** Optional: render as a compact icon button instead of full button */
  compact?: boolean;
  /** Project name for file naming (auto-derived from data/archive if omitted) */
  projectName?: string;
} & (
  | {
      /** Pre-built RecapData from RecapCollector.toRecapData() — preferred, zero extraction cost */
      data: RecapData;
      archive?: never;
    }
  | {
      /** Raw project archive — fallback, runs extraction on click */
      archive: {
        name?: string;
        startedAt?: number;
        endedAt?: number;
        agents?: Array<{ agentId?: string; name: string; role: string; palette?: number }>;
        events?: Array<{ type: string; [key: string]: unknown }>;
        tokenUsage?: { inputTokens: number; outputTokens: number };
      };
      data?: never;
    }
);

type RecapState = "idle" | "generating" | "ready" | "error";

// Inject global focus + animation styles once
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .recap-btn:focus-visible {
      outline: 2px solid #58a6ff;
      outline-offset: 2px;
    }
    .recap-btn:hover {
      background: rgba(88, 166, 255, 0.08) !important;
    }
    .recap-btn--danger:focus-visible {
      outline-color: #f85149;
    }
    .recap-btn--danger:hover {
      background: rgba(248, 81, 73, 0.08) !important;
    }
    .recap-btn--action:hover {
      background: rgba(201, 209, 217, 0.08) !important;
    }
    @keyframes recap-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .recap-spinner { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

export default function ProjectRecap({ data, archive, compact, projectName }: ProjectRecapProps) {
  const [state, setState] = useState<RecapState>("idle");
  const [progress, setProgress] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => { injectStyles(); }, []);

  const name = projectName ?? data?.projectName ?? archive?.name ?? "project";

  const generate = useCallback(async () => {
    setState("generating");
    setError(null);

    try {
      // Step 1: Get RecapData (instant if live, extraction if archive)
      let recapData: RecapData;
      if (data) {
        setProgress("Preparing frames...");
        recapData = data;
      } else {
        setProgress("Extracting milestones...");
        recapData = extractRecapData(archive!);
      }

      setProgress(`Rendering ${recapData.agents.length} agents, ${recapData.filesChanged} files...`);
      await new Promise(r => setTimeout(r, 16)); // yield to UI

      // Step 2: Render frames
      const frames = renderRecapFrames(recapData);
      setProgress(`Encoding ${frames.length} frames to GIF...`);
      await new Promise(r => setTimeout(r, 16));

      // Step 3: Encode GIF
      const blob = encodeGif(frames, FRAME_W, FRAME_H);
      blobRef.current = blob;

      // Create preview URL
      if (gifUrl) URL.revokeObjectURL(gifUrl);
      const url = URL.createObjectURL(blob);
      setGifUrl(url);

      setState("ready");
      setProgress(`GIF ready (${(blob.size / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.error("[ProjectRecap] Generation failed:", e);
      setState("error");
      setError(e instanceof Error ? e.message : "Failed to generate recap");
    }
  }, [data, archive, gifUrl]);

  const download = useCallback(() => {
    if (!blobRef.current) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blobRef.current);
    a.download = `open-office-recap-${name}.gif`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [name]);

  const copyToClipboard = useCallback(async () => {
    if (!blobRef.current) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/gif": blobRef.current }),
      ]);
      setProgress("Copied to clipboard!");
      setTimeout(() => setProgress(`GIF ready (${((blobRef.current?.size ?? 0) / 1024).toFixed(0)}KB)`), 2000);
    } catch {
      download();
    }
  }, [download]);

  const share = useCallback(async () => {
    if (!blobRef.current) return;
    const file = new File(
      [blobRef.current],
      `open-office-recap-${name}.gif`,
      { type: "image/gif" },
    );
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: `Open Office: ${name} Recap`, files: [file] });
    } else {
      download();
    }
  }, [name, download]);

  // ---- Render ----

  if (state === "idle") {
    return (
      <button
        onClick={generate}
        className="recap-btn"
        title="Generate shareable project recap GIF"
        aria-label={compact ? "Share Recap" : undefined}
        style={compact ? compactStyle : buttonStyle}
      >
        {compact ? "\u25B6" : "\u25B6 Share Recap"}
      </button>
    );
  }

  if (state === "generating") {
    return (
      <div style={containerStyle} role="status" aria-live="polite">
        <div className="recap-spinner" style={spinnerStyle} aria-hidden="true" />
        <span style={progressStyle}>{progress}</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={containerStyle} role="alert">
        <span style={errorTextStyle}>
          {error}
        </span>
        <button
          onClick={generate}
          className="recap-btn recap-btn--danger"
          style={retryStyle}
        >
          Retry
        </button>
      </div>
    );
  }

  // state === "ready"
  return (
    <div style={readyContainerStyle}>
      {gifUrl && (
        <div style={previewWrapStyle}>
          <img src={gifUrl} alt={`Project recap animation for ${name}`} style={previewImgStyle} />
        </div>
      )}
      <div style={actionsStyle}>
        <span style={progressStyle}>{progress}</span>
        <div style={btnGroupStyle} role="group" aria-label="Recap actions">
          <button
            onClick={download}
            className="recap-btn recap-btn--action"
            style={actionBtnStyle}
            title="Download GIF"
          >
            {"\u2B07"} Download
          </button>
          <button
            onClick={copyToClipboard}
            className="recap-btn recap-btn--action"
            style={actionBtnStyle}
            title="Copy to clipboard"
          >
            {"\u2398"} Copy
          </button>
          <button
            onClick={share}
            className="recap-btn recap-btn--action"
            style={actionBtnStyle}
            title="Share"
          >
            {"\u2934"} Share
          </button>
          <button
            onClick={generate}
            className="recap-btn recap-btn--action"
            style={{ ...actionBtnStyle, opacity: 0.7 }}
            title="Regenerate"
            aria-label="Regenerate recap"
          >
            {"\u21BB"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Design Tokens ----
// Based on 4px spacing scale, consistent with project design system.
// All interactive elements: min 44×44px touch target, 6px border-radius.

const FONT_MONO = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

// ---- Button base (shared) ----

const btnBase: React.CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  borderRadius: 6,            // space-1.5 (consistent radius)
  fontFamily: FONT_MONO,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  transition: "opacity 0.15s, background 0.15s",
  border: "1px solid transparent",
  background: "transparent",
};

// ---- Component Styles ----

const buttonStyle: React.CSSProperties = {
  ...btnBase,
  borderColor: "#58a6ff",
  color: "#58a6ff",
  padding: "10px 16px",       // space-2.5 / space-4
  fontSize: 13,
};

const compactStyle: React.CSSProperties = {
  ...btnBase,
  borderColor: "#58a6ff",
  color: "#58a6ff",
  padding: "10px 12px",       // space-2.5 / space-3
  fontSize: 16,
  lineHeight: 1,
};

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,                     // space-2
  padding: "8px 0",           // space-2
  minHeight: 44,
};

const spinnerStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  border: "2px solid #30363d",
  borderTopColor: "#58a6ff",
  borderRadius: "50%",
  animation: "recap-spin 0.8s linear infinite",
  flexShrink: 0,
};

const progressStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: FONT_MONO,
  color: "#8b949e",           // DIM — contrast 4.6:1 on #0d1117
};

const errorTextStyle: React.CSSProperties = {
  color: "#f85149",           // RED — contrast 5.2:1 on #0d1117
  fontSize: 13,
  fontFamily: FONT_MONO,
};

const retryStyle: React.CSSProperties = {
  ...btnBase,
  borderColor: "#f85149",
  color: "#f85149",
  padding: "10px 16px",
  fontSize: 13,
};

const readyContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,                     // space-2
};

const previewWrapStyle: React.CSSProperties = {
  borderRadius: 6,
  overflow: "hidden",
  border: "1px solid #30363d",
  background: "#0d1117",
};

const previewImgStyle: React.CSSProperties = {
  width: "100%",
  height: "auto",
  display: "block",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,                     // space-2
};

const btnGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,                     // space-2
  flexWrap: "wrap",
};

const actionBtnStyle: React.CSSProperties = {
  ...btnBase,
  borderColor: "#30363d",
  color: "#c9d1d9",           // BRAND — contrast 9.7:1 on #0d1117
  padding: "10px 14px",
  fontSize: 13,
};
