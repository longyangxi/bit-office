"use client";

/**
 * ProjectRecap.tsx — "Share Recap" button + GIF generation UI.
 *
 * Standalone component. Receives project archive data as props.
 * Generates an animated GIF recap on demand and offers download/copy/share.
 */

import { useState, useCallback, useRef } from "react";
import { extractRecapData } from "./recap-data";
import { renderRecapFrames, FRAME_W, FRAME_H } from "./recap-renderer";
import { encodeGif } from "./gif-encoder";

export interface ProjectRecapProps {
  /** Raw project archive (from gateway's PROJECT_DATA or project-history JSON) */
  archive: {
    name?: string;
    startedAt?: number;
    endedAt?: number;
    agents?: Array<{ agentId?: string; name: string; role: string; palette?: number }>;
    events?: Array<{ type: string; [key: string]: unknown }>;
    tokenUsage?: { inputTokens: number; outputTokens: number };
  };
  /** Optional: render as a compact icon button instead of full button */
  compact?: boolean;
}

type RecapState = "idle" | "generating" | "ready" | "error";

export default function ProjectRecap({ archive, compact }: ProjectRecapProps) {
  const [state, setState] = useState<RecapState>("idle");
  const [progress, setProgress] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const generate = useCallback(async () => {
    setState("generating");
    setError(null);
    setProgress("Extracting milestones...");

    try {
      // Step 1: Extract data
      const data = extractRecapData(archive);
      setProgress(`Rendering ${data.agents.length} agents, ${data.filesChanged} files...`);

      // Yield to UI
      await new Promise(r => setTimeout(r, 16));

      // Step 2: Render frames
      const frames = renderRecapFrames(data);
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
  }, [archive, gifUrl]);

  const download = useCallback(() => {
    if (!blobRef.current) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blobRef.current);
    a.download = `open-office-recap-${archive.name ?? "project"}.gif`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [archive.name]);

  const copyToClipboard = useCallback(async () => {
    if (!blobRef.current) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/gif": blobRef.current }),
      ]);
      setProgress("Copied to clipboard!");
      setTimeout(() => setProgress(`GIF ready (${((blobRef.current?.size ?? 0) / 1024).toFixed(0)}KB)`), 2000);
    } catch {
      // Fallback: download instead
      download();
    }
  }, [download]);

  const share = useCallback(async () => {
    if (!blobRef.current) return;
    const file = new File(
      [blobRef.current],
      `open-office-recap-${archive.name ?? "project"}.gif`,
      { type: "image/gif" },
    );
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: `Open Office: ${archive.name ?? "Project"} Recap`,
        files: [file],
      });
    } else {
      download();
    }
  }, [archive.name, download]);

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
      {/* Preview */}
      {gifUrl && (
        <div style={previewWrapStyle}>
          <img
            src={gifUrl}
            alt="Project Recap"
            style={previewImgStyle}
          />
        </div>
      )}

      {/* Actions */}
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
