"use client";

/**
 * ProjectRecap.tsx — "Share Recap" button + GIF generation UI.
 *
 * Two input modes:
 *   1. `data` prop — pre-built RecapData from a live RecapCollector (zero extraction cost)
 *   2. `archive` prop — raw ProjectArchive (will run extractRecapData on click)
 *
 * Rendering only happens when user clicks "Share Recap" — never during project execution.
 */

import { useState, useCallback, useRef } from "react";
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

export default function ProjectRecap({ data, archive, compact, projectName }: ProjectRecapProps) {
  const [state, setState] = useState<RecapState>("idle");
  const [progress, setProgress] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

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
        className="recap-btn recap-btn--generate"
        title="Generate shareable project recap GIF"
        style={compact ? compactStyle : buttonStyle}
      >
        {compact ? "\u25B6" : "\u25B6 Share Recap"}
      </button>
    );
  }

  if (state === "generating") {
    return (
      <div style={containerStyle}>
        <div style={spinnerStyle} />
        <span style={progressStyle}>{progress}</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={containerStyle}>
        <span style={{ color: "#f85149", fontSize: 12, fontFamily: "monospace" }}>
          {error}
        </span>
        <button onClick={generate} style={retryStyle}>Retry</button>
      </div>
    );
  }

  // state === "ready"
  return (
    <div style={readyContainerStyle}>
      {gifUrl && (
        <div style={previewWrapStyle}>
          <img src={gifUrl} alt="Project Recap" style={previewImgStyle} />
        </div>
      )}
      <div style={actionsStyle}>
        <span style={progressStyle}>{progress}</span>
        <div style={btnGroupStyle}>
          <button onClick={download} style={actionBtnStyle} title="Download GIF">
            {"\u2B07"} Download
          </button>
          <button onClick={copyToClipboard} style={actionBtnStyle} title="Copy to clipboard">
            {"\u2398"} Copy
          </button>
          <button onClick={share} style={actionBtnStyle} title="Share">
            {"\u2934"} Share
          </button>
          <button onClick={generate} style={{ ...actionBtnStyle, opacity: 0.6 }} title="Regenerate">
            {"\u21BB"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Inline styles (self-contained, no CSS dependency) ----

const buttonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #58a6ff",
  color: "#58a6ff",
  padding: "6px 14px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  cursor: "pointer",
  transition: "opacity 0.15s",
};

const compactStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: "4px 8px",
  fontSize: 14,
  lineHeight: 1,
};

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
};

const spinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  border: "2px solid #30363d",
  borderTopColor: "#58a6ff",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const progressStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "'SF Mono', monospace",
  color: "#8b949e",
};

const retryStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: "#f85149",
  color: "#f85149",
  padding: "2px 8px",
  fontSize: 11,
};

const readyContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
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
};

const btnGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const actionBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #30363d",
  color: "#c9d1d9",
  padding: "3px 10px",
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "'SF Mono', monospace",
  cursor: "pointer",
};
