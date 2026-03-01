"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOfficeStore } from "@/store/office-store";
import type { ChatMessage, TeamChatMessage } from "@/store/office-store";
import { connect, sendCommand, disconnect } from "@/lib/connection";
import { getConnection } from "@/lib/storage";
import { nanoid } from "nanoid";
import ReactMarkdown from "react-markdown";
import { AGENT_PRESETS } from "@/lib/presets";
import { getCharacterThumbnail } from "@/components/office/sprites/spriteData";
import { OfficeState } from "@/components/office/engine/officeState";
import { EditorState } from "@/components/office/editor/editorState";
import { EditTool } from "@/components/office/types";
import { ZOOM_MIN, ZOOM_MAX } from "@/components/office/constants";
import { useEditorActions, loadLayoutFromStorage, saveLayoutToStorage } from "@/hooks/useEditorActions";
import { useEditorKeyboard } from "@/hooks/useEditorKeyboard";
import { migrateLayoutColors } from "@/components/office/layout/layoutSerializer";
import dynamic from "next/dynamic";
const OfficeCanvas = dynamic(() => import("@/components/office/OfficeCanvas"), { ssr: false });
const EditorToolbar = dynamic(() => import("@/components/office/editor/EditorToolbar"), { ssr: false });
const ZoomControls = dynamic(() => import("@/components/office/ui/ZoomControls"), { ssr: false });
const SettingsModal = dynamic(() => import("@/components/office/ui/SettingsModal"), { ssr: false });
const BottomToolbar = dynamic(() => import("@/components/office/ui/BottomToolbar"), { ssr: false });

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  idle: { color: "#7a7060", label: "Idle" },
  working: { color: "#5aacff", label: "Working..." },
  waiting_approval: { color: "#e89030", label: "Needs Approval" },
  done: { color: "#48cc6a", label: "Done" },
  error: { color: "#e04848", label: "Error" },
};

// Match URLs (including inside [] brackets) and file paths
const LINKIFY_RE = /\[?(https?:\/\/[^\s)>\]]+)\]?|((?:open\s+)?\/[\w./-]+\.\w+)/g;

function linkifyText(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    LINKIFY_RE.lastIndex = 0;
    while ((match = LINKIFY_RE.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index));
      }
      const url = match[1];
      const filePath = match[2];
      if (url) {
        parts.push(
          <a
            key={match.index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#e8b040", textDecoration: "underline" }}
          >{url}</a>
        );
      } else if (filePath) {
        const path = filePath.replace(/^open\s+/, "");
        parts.push(
          <span
            key={match.index}
            onClick={() => sendCommand({ type: "OPEN_FILE", path })}
            style={{
              color: "#e8b040", textDecoration: "underline", cursor: "pointer",
              fontFamily: "monospace", fontSize: 13,
            }}
            title="Click to open"
          >{filePath}</span>
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (parts.length === 0) return children;
    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex));
    }
    return parts;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? linkifyText(child) : child
    );
  }
  return children;
}

function ThinkingBubble({ logLine }: { logLine: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{
        padding: "8px 12px",
        backgroundColor: "#1e1a30", color: "#7a8a6a", fontSize: 11,
        fontFamily: "monospace",
        border: "1px solid #3d2e54",
        borderLeft: "2px solid #e8b04060",
        maxWidth: "100%", overflow: "hidden",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        <span style={{ opacity: 0.5, marginRight: 6 }}>{">"}</span>
        {logLine || "Thinking..."}
      </div>
    </div>
  );
}

function PreviewOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  // Wait a fixed delay for the preview server to start, then show iframe
  useEffect(() => {
    setStatus("loading");
    const timer = setTimeout(() => setStatus("ready"), 3000);
    return () => clearTimeout(timer);
  }, [url]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(0,0,0,0.85)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        height: 40, display: "flex", alignItems: "center",
        padding: "0 12px", backgroundColor: "#1a1530", gap: 8,
      }}>
        <span style={{
          flex: 1, color: "#888", fontSize: 13,
          fontFamily: "monospace", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#e8b040", fontSize: 11, textDecoration: "none",
            padding: "2px 8px", border: "1px solid #3d2d10", fontFamily: "monospace",
          }}
        >Open in tab</a>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "1px solid #444",
            color: "#aaa", fontSize: 16, cursor: "pointer",
            borderRadius: 6, width: 28, height: 28,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      </div>
      {status === "loading" && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <div style={{
            width: 32, height: 32, border: "3px solid #333",
            borderTopColor: "#818cf8", borderRadius: "50%",
            animation: "preview-spin 0.8s linear infinite",
          }} />
          <div style={{ color: "#888", fontSize: 14 }}>Starting server...</div>
          <style>{`@keyframes preview-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {status === "ready" && (
        <iframe
          src={url}
          style={{ flex: 1, border: "none", width: "100%" }}
        />
      )}
    </div>
  );
}

function ConfettiOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd", "#01a3a4", "#ff5e57", "#0abde3", "#10ac84"];
    interface Paper { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; rotSpeed: number; color: string; alpha: number }
    const papers: Paper[] = [];
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < 120; i++) {
      papers.push({
        x: Math.random() * W,
        y: -Math.random() * H * 0.8,
        vx: (Math.random() - 0.5) * 2,
        vy: 1.5 + Math.random() * 3,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
      });
    }
    const start = performance.now();
    const DURATION = 3000;
    let raf: number;
    const animate = (now: number) => {
      const elapsed = now - start;
      const fadeAlpha = elapsed > DURATION - 800 ? Math.max(0, 1 - (elapsed - (DURATION - 800)) / 800) : 1;
      ctx.clearRect(0, 0, W, H);
      for (const p of papers) {
        p.x += p.vx + Math.sin(now * 0.002 + p.rot) * 0.5;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        // Wrap horizontally, reset if fallen below
        if (p.x < -20) p.x = W + 20;
        if (p.x > W + 20) p.x = -20;
        if (p.y > H + 20) { p.y = -10; p.x = Math.random() * W; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < DURATION) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}
    />
  );
}

function CelebrationModal({ previewUrl, previewPath, onPreview, onDismiss }: {
  previewUrl?: string;
  previewPath?: string;
  onPreview: (url: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        backgroundColor: "#231e38", padding: "28px 24px",
        maxWidth: 420, width: "90%", textAlign: "center",
        border: "2px solid #e8b040", boxShadow: "0 0 40px rgba(200,155,48,0.15), 4px 4px 0px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>★</div>
        <div className="px-font" style={{ color: "#e8b040", fontSize: 13, marginBottom: 10, letterSpacing: "0.05em" }}>
          Mission Complete!
        </div>
        <div style={{
          color: "#9a8a68", fontSize: 13, marginBottom: 20, lineHeight: 1.7, fontFamily: "monospace",
        }}>
          Your task has been completed successfully. Ready for the next mission whenever you are.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {previewUrl && (
            <button
              onClick={() => {
                if (previewPath) {
                  sendCommand({ type: "SERVE_PREVIEW", filePath: previewPath });
                }
                onPreview(previewUrl);
              }}
              style={{
                padding: "9px 20px", border: "1px solid #48cc6a",
                backgroundColor: "#143a14", color: "#48cc6a",
                fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              }}
            >
              ▶ Preview
            </button>
          )}
          <button
            onClick={onDismiss}
            style={{
              padding: "9px 20px",
              border: "1px solid #3d2e54", backgroundColor: "#1e1a30",
              color: "#9a8a68", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Custom Confirm Modal ─────────────────────────────────────────── */
function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "#1a1a2e", borderRadius: 14, padding: "28px 24px",
          maxWidth: 380, width: "90%", textAlign: "center",
          border: "1px solid #333", boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ color: "#eee", fontSize: 16, lineHeight: 1.6, marginBottom: 24 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 28px", borderRadius: 8,
              border: "1px solid #444", backgroundColor: "#2a2a3e",
              color: "#aaa", fontSize: 14, cursor: "pointer",
            }}
          >
            No
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 28px", borderRadius: 8, border: "none",
              backgroundColor: "#dc2626", color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [state, setState] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);
  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);
  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);
  const modal = state ? (
    <ConfirmModal message={state.message} onConfirm={handleConfirm} onCancel={handleCancel} />
  ) : null;
  return { confirm, modal };
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  pre({ children }) {
    return (
      <div style={{ overflowX: "auto", margin: "6px 0", WebkitOverflowScrolling: "touch" }}>
        {children}
      </div>
    );
  },
  p({ children }) {
    return <div style={{ margin: "4px 0" }}>{children}</div>;
  },
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, "");
    const isBlock = className?.includes("language-") || text.includes("\n");
    const openMatch = text.match(/^open\s+(\/\S+)/);
    const fileMatch = !openMatch ? text.match(/^(\/[\w./-]+\.\w+)$/) : null;
    const filePath = openMatch?.[1] ?? fileMatch?.[1];
    if (filePath) {
      return (
        <pre
          onClick={() => sendCommand({ type: "OPEN_FILE", path: filePath })}
          style={{
            backgroundColor: "#1a1830", padding: "8px 10px", borderRadius: 6,
            fontSize: 12, cursor: "pointer", border: "1px solid #2a2a4a",
            display: "flex", alignItems: "center", gap: 8, whiteSpace: "pre",
          }}
          title="Click to open"
        >
          <span style={{ fontSize: 14 }}>&#x1F517;</span>
          <code style={{ fontFamily: "monospace", color: "#818cf8" }} {...props}>{text}</code>
        </pre>
      );
    }
    return isBlock ? (
      <pre style={{
        backgroundColor: "#1a1830", padding: "8px 10px", borderRadius: 6,
        fontSize: 12, whiteSpace: "pre",
      }}>
        <code style={{ fontFamily: "monospace", color: "#a5b4fc" }} {...props}>{children}</code>
      </pre>
    ) : (
      <code style={{
        backgroundColor: "#1a1830", padding: "1px 5px", borderRadius: 4,
        fontFamily: "monospace", color: "#a5b4fc", fontSize: 13,
      }} {...props}>{children}</code>
    );
  },
  table({ children }) {
    return (
      <div style={{ overflowX: "auto", margin: "6px 0", WebkitOverflowScrolling: "touch" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th style={{ padding: "4px 10px", borderBottom: "1px solid #444", textAlign: "left", color: "#e2e8f0" }}>{children}</th>;
  },
  td({ children }) {
    return <td style={{ padding: "4px 10px", borderBottom: "1px solid #222" }}>{children}</td>;
  },
  ul({ children }) {
    return <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ol>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#818cf8", textDecoration: "underline" }}>{children}</a>;
  },
  strong({ children }) {
    return <strong style={{ color: "#f0f0f0" }}>{children}</strong>;
  },
};

function MdContent({ text }: { text: string }) {
  return (
    <ReactMarkdown urlTransform={(url) => url} components={mdComponents}>
      {text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)')}
    </ReactMarkdown>
  );
}

function MessageBubble({ msg, onPreview, isTeamLead, isTeamMember }: { msg: ChatMessage; onPreview?: (url: string) => void; isTeamLead?: boolean; isTeamMember?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div style={{
          maxWidth: "80%", padding: "8px 12px",
          backgroundColor: "#382800", color: "#eddcb8", fontSize: 13, wordBreak: "break-word",
          border: "1px solid #e8b04050",
          borderLeft: "2px solid #e8b040",
        }}>
          {linkifyText(msg.text)}
        </div>
      </div>
    );
  }

  if (msg.role === "system") {
    const isDelegation = msg.text.startsWith("Delegated to ");
    const isResult = msg.text.startsWith("Result from ");
    const isQueued = msg.text.startsWith("Task queued ");
    const isTeam = isDelegation || isResult || isQueued;

    const bg = isDelegation ? "#182844" : isResult ? "#143822" : isQueued ? "#282010" : "#3e1818";
    const border = isDelegation ? "#5aacff44" : isResult ? "#48cc6a44" : isQueued ? "#e8b04044" : "#e0484844";
    const color = isDelegation ? "#7ab8f5" : isResult ? "#7ad89a" : isQueued ? "#e8b040" : "#c87070";

    return (
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
        <div style={{
          maxWidth: "80%", padding: "8px 12px",
          backgroundColor: bg, border: `1px solid ${border}`, color,
          fontSize: isTeam ? 11 : 13, wordBreak: "break-word",
          fontFamily: "monospace",
        }} className="chat-markdown">
          {isTeam && <span style={{ fontSize: 9, opacity: 0.6, marginRight: 4 }}>
            {isDelegation ? "[delegation]" : isResult ? "[result]" : "[queued]"}
          </span>}
          <MdContent text={msg.text} />
        </div>
      </div>
    );
  }

  const hasFullOutput = !!(msg.result?.fullOutput && msg.result.fullOutput !== msg.text && msg.result.fullOutput.length > msg.text.length + 20);

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{
        maxWidth: "85%", padding: "8px 12px",
        backgroundColor: "#231e38", color: "#d8c8a8", fontSize: 13,
        wordBreak: "break-word", overflow: "hidden", minWidth: 0,
        border: "1px solid #3d2e54",
        borderLeft: "2px solid #3d2e54",
      }} className="chat-markdown">
        <MdContent text={expanded && msg.result?.fullOutput ? msg.result.fullOutput : msg.text} />
        {hasFullOutput && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              marginTop: 6, padding: "3px 8px",
              backgroundColor: "transparent", color: "#e8b040",
              border: "1px solid #e8b04040", cursor: "pointer",
              fontSize: 10, fontFamily: "monospace",
            }}
          >
            {expanded ? "▲ Collapse" : "▼ Full output"}
          </button>
        )}
        {msg.result && msg.result.changedFiles.length > 0 && (
          <div style={{
            marginTop: 8, padding: "6px 8px",
            backgroundColor: "#1a1530", fontSize: 11, border: "1px solid #3d2e54",
          }}>
            <div style={{ color: "#7a6858", marginBottom: 4, fontFamily: "monospace" }}>Changed {msg.result.changedFiles.length} files</div>
            {msg.result.changedFiles.slice(0, 5).map((f, i) => (
              <div key={i} style={{ fontFamily: "monospace", color: "#e8b040", opacity: 0.8 }}>{f}</div>
            ))}
            {msg.result.changedFiles.length > 5 && (
              <div style={{ color: "#7a6858", fontFamily: "monospace" }}>...and {msg.result.changedFiles.length - 5} more</div>
            )}
          </div>
        )}
        {msg.result?.previewUrl && onPreview
          && !isTeamMember
          && (!isTeamLead || msg.isFinalResult)
        && (
          <button
            onClick={() => {
              if (msg.result!.previewPath) {
                sendCommand({ type: "SERVE_PREVIEW", filePath: msg.result!.previewPath });
              }
              onPreview(msg.result!.previewUrl!);
            }}
            style={{
              marginTop: 8, padding: "5px 12px",
              backgroundColor: "#143a14", color: "#48cc6a",
              border: "1px solid #48cc6a50", cursor: "pointer",
              fontSize: 11, fontWeight: 700, fontFamily: "monospace",
            }}
          >
            ▶ Preview
          </button>
        )}
      </div>
    </div>
  );
}

function SpriteAvatar({ palette, zoom = 3, ready }: { palette: number; zoom?: number; ready?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sprite = getCharacterThumbnail(palette);
    if (!sprite) return;
    const h = sprite.length;
    const w = sprite[0]?.length ?? 0;
    canvas.width = w * zoom;
    canvas.height = h * zoom;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const color = sprite[r][c];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
        }
      }
    }
  }, [palette, zoom, ready]);

  return <canvas ref={canvasRef} style={{ width: 16 * zoom, height: 32 * zoom, imageRendering: "pixelated" }} />;
}

const BACKEND_OPTIONS = [
  { id: "claude", name: "Claude", color: "#d97706" },
  { id: "codex", name: "Codex", color: "#a855f7" },
  { id: "gemini", name: "Gemini", color: "#3b82f6" },
  { id: "aider", name: "Aider", color: "#22c55e" },
  { id: "opencode", name: "OpenCode", color: "#06b6d4" },
];

function HireModal({ onHire, onClose, assetsReady }: {
  onHire: (name: string, role: string, palette: number, personality: string, backend: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1e1a30", padding: "14px 14px 10px",
          width: "90%", maxWidth: 320, border: "2px solid #3d2e54",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 10, margin: "0 0 12px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Agent</h2>

        {/* Backend selector */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>AI BACKEND</div>
          <div style={{ display: "flex", gap: 3 }}>
            {BACKEND_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBackend(b.id)}
                style={{
                  flex: 1, padding: "5px 4px", fontSize: 10, fontWeight: 600,
                  border: selectedBackend === b.id ? `1px solid ${b.color}` : "1px solid #3d2e54",
                  backgroundColor: selectedBackend === b.id ? b.color + "20" : "transparent",
                  color: selectedBackend === b.id ? b.color : "#6a5848",
                  cursor: "pointer", fontFamily: "monospace",
                }}
              >{b.name}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {AGENT_PRESETS.map((preset) => (
            <button
              key={preset.palette}
              onClick={() => onHire(preset.name, preset.description, preset.palette, preset.personality, selectedBackend)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "5px 8px",
                border: "1px solid #3d2e54", backgroundColor: "transparent",
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#272040"; e.currentTarget.style.borderColor = "#e8b04040"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#3d2e54"; }}
            >
              <SpriteAvatar palette={preset.palette} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>{preset.name}</div>
                <div style={{ fontSize: 10, color: "#7a6858" }}>{preset.role} · {preset.description}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%", marginTop: 8, padding: "7px",
            border: "1px solid #3d2e54", backgroundColor: "transparent",
            color: "#6a5848", fontSize: 11, cursor: "pointer", fontFamily: "monospace",
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

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
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "#5a4838", padding: 30, fontSize: 11, fontFamily: "monospace" }}>
        No team activity yet. Hire a team and send a task to the Team Lead.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
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
              <span style={{ fontSize: 11, fontWeight: 700, color: "#eddcb8" }}>
                {msg.fromAgentName ?? msg.fromAgentId}
              </span>
              {msg.toAgentName && (
                <>
                  <span style={{ fontSize: 10, color: "#6a5848" }}>&rarr;</span>
                  {toAgent?.palette !== undefined && (
                    <SpriteAvatar palette={toAgent.palette} zoom={1} ready={assetsReady} />
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#eddcb8" }}>
                    {msg.toAgentName}
                  </span>
                </>
              )}
              <span style={{
                marginLeft: "auto", fontSize: 8, padding: "1px 4px",
                backgroundColor: cfg.border + "20", color: cfg.border,
                border: `1px solid ${cfg.border}40`, fontFamily: "monospace",
              }}>
                {cfg.label}
              </span>
            </div>
            <div style={{
              fontSize: 11, color: "#b09878", wordBreak: "break-word",
              maxHeight: 120, overflow: "hidden", fontFamily: "monospace",
            }}>
              {msgText.slice(0, 300)}{msgText.length > 300 ? "..." : ""}
            </div>
            <div style={{ fontSize: 9, color: "#5a4838", marginTop: 4, fontFamily: "monospace" }}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function HireTeamModal({ onCreateTeam, onClose, assetsReady }: {
  onCreateTeam: (leadIndex: number, memberIndices: number[], backends: Record<string, string>) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const [leadIndex, setLeadIndex] = useState(5); // Marcus default
  const [memberChecked, setMemberChecked] = useState<boolean[]>(AGENT_PRESETS.map((_, i) => i !== 5));
  const [backends, setBackends] = useState<Record<string, string>>({});

  const toggleMember = (idx: number) => {
    if (idx === leadIndex) return; // Can't uncheck the lead
    setMemberChecked((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const handleCreate = () => {
    const memberIndices = memberChecked
      .map((checked, i) => (checked && i !== leadIndex) ? i : -1)
      .filter((i) => i >= 0);
    onCreateTeam(leadIndex, memberIndices, backends);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1e1a30", padding: "14px 14px 10px",
          width: "90%", maxWidth: 380, border: "2px solid #3d2e54",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 10, margin: "0 0 12px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Team</h2>

        <div style={{ fontSize: 9, color: "#7a6858", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.05em" }}>SELECT TEAM LEAD</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
          {AGENT_PRESETS.map((preset, idx) => (
            <button
              key={preset.palette}
              onClick={() => {
                setLeadIndex(idx);
                setMemberChecked((prev) => prev.map((c, i) => i === idx ? false : c));
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                border: idx === leadIndex ? "1px solid #e8903070" : "1px solid #3d2e54",
                backgroundColor: idx === leadIndex ? "#261a00" : "transparent",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <SpriteAvatar palette={preset.palette} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
                  {preset.name} {idx === leadIndex && <span style={{ color: "#e89030", fontSize: 8, fontFamily: "monospace" }}>LEAD</span>}
                </div>
                <div style={{ fontSize: 10, color: "#7a6858" }}>{preset.role}</div>
              </div>
              {idx !== leadIndex && (
                <input
                  type="checkbox"
                  checked={memberChecked[idx]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleMember(idx)}
                  style={{ cursor: "pointer", accentColor: "#e8b040" }}
                />
              )}
              <select
                value={backends[String(idx)] ?? "claude"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setBackends((prev) => ({ ...prev, [String(idx)]: e.target.value }))}
                style={{
                  padding: "2px 4px", border: "1px solid #3d2e54",
                  backgroundColor: "#1a1530", color: "#9a8a68", fontSize: 9, cursor: "pointer", fontFamily: "monospace",
                }}
              >
                {BACKEND_OPTIONS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleCreate}
            style={{
              flex: 1, padding: "9px", border: "1px solid #e8b04060",
              backgroundColor: "#382800", color: "#e8b040", fontSize: 11,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
            }}
          >Create Team</button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 14px",
              border: "1px solid #3d2e54", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 11, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function OfficePage() {
  const router = useRouter();
  const { agents, connected, addUserMessage, teamMessages, clearTeamMessages } = useOfficeStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ previewUrl?: string; previewPath?: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const { confirm, modal: confirmModal } = useConfirm();
  const [showHireModal, setShowHireModal] = useState(false);
  const [showHireTeamModal, setShowHireTeamModal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"agents" | "team">("agents");
  const [prompt, setPrompt] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Editor state
  const [editMode, setEditMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [, forceUpdate] = useState(0);
  const editorRef = useRef(new EditorState());
  const officeStateRef = useRef<OfficeState | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [assetsReady, setAssetsReady] = useState(false);

  // Load sound preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem('office-sound-enabled');
      if (stored !== null) setSoundEnabled(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // Celebrate task completion:
  // - Solo agent (no teamId, not leader): status === "done"
  // - Team leader: message has isFinalResult === true (set by orchestrator when no pending delegations)
  const { hydrated } = useOfficeStore();
  const seenCelebrationIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    // First run: seed all existing result message IDs as seen
    if (seenCelebrationIdsRef.current === null) {
      const seen = new Set<string>();
      for (const [, agentState] of agents) {
        for (const msg of agentState.messages) {
          if (msg.result || msg.isFinalResult) seen.add(msg.id);
        }
      }
      seenCelebrationIdsRef.current = seen;
      return;
    }
    for (const [, agentState] of agents) {
      for (const msg of agentState.messages) {
        if (!msg.result) continue;
        if (seenCelebrationIdsRef.current.has(msg.id)) continue;
        seenCelebrationIdsRef.current.add(msg.id);
        // Only celebrate when actual work was done (code changes, tests, or preview)
        const r = msg.result;
        if (r.changedFiles.length === 0 && r.testResult === "unknown" && !r.previewUrl) continue;
        // Team member → never celebrate
        if (agentState.teamId && !agentState.isTeamLead) continue;
        // Team leader → only celebrate when isFinalResult is explicitly true
        if (agentState.isTeamLead && !msg.isFinalResult) continue;
        // Solo agent or leader with isFinalResult → celebrate
        setCelebration({ previewUrl: r.previewUrl, previewPath: r.previewPath });
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }
    }
  }, [hydrated, agents]);

  const onLayoutChange = useCallback(() => {
    forceUpdate((n) => n + 1);
  }, []);

  const {
    handleTileClick,
    handleRightClick,
    handleDeleteSelected,
    handleRotateSelected,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    updateGhost,
    handleUndo,
    handleRedo,
    handleImportLayout,
    handleSelectedFurnitureColorChange,
  } = useEditorActions(editorRef, officeStateRef, onLayoutChange);

  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      if (!next) {
        editorRef.current.reset();
      }
      return next;
    });
  }, []);

  useEditorKeyboard({
    editMode,
    editorRef,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDeleteSelected: handleDeleteSelected,
    onRotateSelected: handleRotateSelected,
    onExitEditMode: toggleEditMode,
  });

  // Load saved layout on mount
  const handleAssetsLoaded = useCallback(() => {
    const saved = loadLayoutFromStorage();
    if (saved && officeStateRef.current) {
      const migrated = migrateLayoutColors(saved);
      officeStateRef.current.setLayout(migrated);
      forceUpdate((n) => n + 1);
    }
    setAssetsReady(true);
  }, []);

  useEffect(() => {
    const conn = getConnection();
    if (!conn) {
      router.push("/pair");
      return;
    }
    useOfficeStore.getState().hydrate();
    connect(conn);
    return () => { disconnect(); };
  }, [router]);

  const selectedAgentState = selectedAgent ? agents.get(selectedAgent) : null;
  const isAgentBusy = selectedAgentState?.status === "working" || selectedAgentState?.status === "waiting_approval";

  useEffect(() => {
      // Scroll only the chat messages container, not the entire sidebar
      const el = chatEndRef.current;
      if (!el) return;
      const container = el.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    
  }, [selectedAgentState?.messages?.length, selectedAgentState?.status]);

  // Auto-select team lead when a team is first created
  useEffect(() => {
    if (selectedAgent) return;
    const lead = Array.from(agents.values()).find(a => a.isTeamLead);
    if (lead) {
      setSelectedAgent(lead.agentId);
      setChatOpen(true);
    }
  }, [agents, selectedAgent]);

  const handleAgentClick = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
    setChatOpen(true);
  }, []);

  const handleHire = useCallback((name: string, role: string, palette: number, personality: string, backend: string) => {
    const existing = Array.from(agents.values()).filter(
      (a) => a.name === name || a.name.match(new RegExp(`^${name} \\d+$`))
    );
    const displayName = existing.length === 0 ? name : `${name} ${existing.length + 1}`;
    const agentId = `agent-${nanoid(6)}`;
    sendCommand({ type: "CREATE_AGENT", agentId, name: displayName, role, palette, personality, backend });
    setSelectedAgent(agentId);
    setChatOpen(true);
    setShowHireModal(false);
  }, [agents]);

  const handleCreateTeam = useCallback((leadIndex: number, memberIndices: number[], backends: Record<string, string>) => {
    sendCommand({ type: "CREATE_TEAM", leadPresetIndex: leadIndex, memberPresetIndices: memberIndices, backends });
    setShowHireTeamModal(false);
    setSidebarTab("agents");
  }, []);

  const handleFire = useCallback(async (agentId: string) => {
    if (!await confirm(`Fire ${agents.get(agentId)?.name ?? agentId}?`)) return;
    sendCommand({ type: "FIRE_AGENT", agentId });
    if (selectedAgent === agentId) {
      setSelectedAgent(null);
      setChatOpen(false);
    }
  }, [selectedAgent, agents, confirm]);

  const hasTeam = Array.from(agents.values()).some((a) => !!a.teamId);

  const teamBusy = Array.from(agents.values()).some(
    (a) => !!a.teamId && (a.status === "working" || a.status === "waiting_approval"),
  );

  const handleStopTeam = useCallback(() => {
    sendCommand({ type: "STOP_TEAM" });
    const teamAgents = Array.from(agents.values()).filter((a) => !!a.teamId);
    for (const a of teamAgents) {
      sendCommand({ type: "CANCEL_TASK", agentId: a.agentId, taskId: "" });
    }
  }, [agents]);

  const handleFireTeam = useCallback(async () => {
    const teamAgents = Array.from(agents.values()).filter((a) => !!a.teamId);
    if (teamAgents.length === 0) return;
    const msg = `Fire the entire team (${teamAgents.length} agents)?`;
    if (!await confirm(msg)) return;
    sendCommand({ type: "FIRE_TEAM" });
    for (const a of teamAgents) {
      sendCommand({ type: "FIRE_AGENT", agentId: a.agentId });
    }
    clearTeamMessages();
    setSelectedAgent(null);
    setChatOpen(false);
    setSidebarTab("agents");
  }, [agents, clearTeamMessages, confirm]);

  const handleRunTask = useCallback(() => {
    if (!selectedAgent || !prompt.trim()) return;
    const agent = agents.get(selectedAgent);
    const taskId = nanoid();
    addUserMessage(selectedAgent, taskId, prompt.trim());
    sendCommand({
      type: "RUN_TASK",
      agentId: selectedAgent,
      taskId,
      prompt: prompt.trim(),
      name: agent?.name,
      role: agent?.role,
      personality: agent?.personality,
    });
    setPrompt("");
  }, [selectedAgent, prompt, addUserMessage, agents]);

  const handleCancel = useCallback(() => {
    if (!selectedAgent) return;
    sendCommand({ type: "CANCEL_TASK", agentId: selectedAgent, taskId: "" });
  }, [selectedAgent]);

  const handleApproval = useCallback((approvalId: string, decision: "yes" | "no") => {
    sendCommand({ type: "APPROVAL_DECISION", approvalId, decision });
  }, []);

  // Zoom controls
  const handleZoomChange = useCallback((newZoom: number) => {
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    forceUpdate((n) => n + 1);
  }, []);

  const agentList = Array.from(agents.values());
  const editor = editorRef.current;

  // Responsive: detect mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const SIDEBAR_W = 340;
  const isChatExpanded = chatOpen && selectedAgent !== null;

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative", overflow: "hidden", display: "flex" }}>
      {/* Game Scene — fills remaining space */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <OfficeCanvas
          onAgentClick={handleAgentClick}
          selectedAgent={selectedAgent}
          editMode={editMode}
          editorRef={editorRef}
          stateRef={officeStateRef}
          zoomRef={zoomRef}
          panRef={panRef}
          onTileClick={handleTileClick}
          onTileRightClick={handleRightClick}
          onGhostMove={updateGhost}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDeleteBtnClick={handleDeleteSelected}
          onRotateBtnClick={handleRotateSelected}
          onAssetsLoaded={handleAssetsLoaded}
        />

        {/* Top-left status bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
          background: "linear-gradient(to bottom, rgba(22,18,42,0.90) 0%, rgba(22,18,42,0) 100%)",
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
            <h1 className="px-font" style={{ fontSize: 11, margin: 0, color: "#e8b040", textShadow: "2px 2px 0px rgba(0,0,0,0.8), 0 0 12px rgba(200,155,48,0.3)", letterSpacing: "0.05em" }}>Bit Office</h1>
            <span style={{
              fontSize: 9, padding: "3px 7px",
              border: `1px solid ${connected ? "#2a5c2a" : "#5c1a1a"}`,
              backgroundColor: connected ? "#143a14" : "#3e1818",
              color: connected ? "#48cc6a" : "#e04848",
              fontFamily: "monospace", letterSpacing: "0.05em",
            }}>
              {connected ? "● ONLINE" : "● OFFLINE"}
            </span>
            {editMode && (
              <span style={{
                fontSize: 9, padding: "3px 7px",
                border: "1px solid #5a3a10",
                backgroundColor: "#1a0e00", color: "#e8b040",
                fontFamily: "monospace",
              }}>
                EDIT MODE
              </span>
            )}
          </div>
        </div>

        {/* Editor Toolbar */}
        {editMode && (
          <EditorToolbar
            activeTool={editor.activeTool}
            selectedTileType={editor.selectedTileType}
            selectedFurnitureType={editor.selectedFurnitureType}
            selectedFurnitureUid={editor.selectedFurnitureUid}
            selectedFurnitureColor={(() => {
              if (!editor.selectedFurnitureUid || !officeStateRef.current) return null;
              const item = officeStateRef.current.layout.furniture.find((f) => f.uid === editor.selectedFurnitureUid);
              return item?.color ?? null;
            })()}
            floorColor={editor.floorColor}
            wallColor={editor.wallColor}
            onToolChange={(tool) => {
              editor.activeTool = tool as typeof editor.activeTool;
              editor.clearSelection();
              forceUpdate((n) => n + 1);
            }}
            onTileTypeChange={(type) => { editor.selectedTileType = type; forceUpdate((n) => n + 1); }}
            onFloorColorChange={(color) => { editor.floorColor = color; forceUpdate((n) => n + 1); }}
            onWallColorChange={(color) => { editor.wallColor = color; forceUpdate((n) => n + 1); }}
            onSelectedFurnitureColorChange={handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={(type) => { editor.selectedFurnitureType = type; editor.activeTool = EditTool.FURNITURE_PLACE; forceUpdate((n) => n + 1); }}
          />
        )}

        {/* Bottom Toolbar (desktop only) */}
        {!isMobile && (
          <BottomToolbar
            editMode={editMode}
            onToggleEditMode={toggleEditMode}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

      </div>

      {/* ── Right Sidebar (desktop only) ── */}
      {!isMobile && (
        <div style={{
          width: "33vw",
          minWidth: 300,
          maxWidth: 500,
          flexShrink: 0,
          height: "100vh",
          backgroundColor: "#1e1a30",
          borderLeft: "2px solid #3d2e54",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Sidebar header: tab toggle + hire buttons */}
          <div style={{ padding: "8px 10px 6px", flexShrink: 0, borderBottom: "1px solid #2e2448" }}>
            {/* Tab toggle */}
            <div style={{ display: "flex", gap: 0, marginBottom: 8, border: "1px solid #3d2e54", overflow: "hidden" }}>
              <button
                onClick={() => setSidebarTab("agents")}
                style={{
                  flex: 1, padding: "8px 6px", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer",
                  borderRight: "1px solid #3d2e54",
                  backgroundColor: sidebarTab === "agents" ? "#382800" : "#1a1530",
                  color: sidebarTab === "agents" ? "#e8b040" : "#6a5848",
                  fontFamily: "'Press Start 2P', monospace",
                  letterSpacing: "0.03em",
                  boxShadow: sidebarTab === "agents" ? "inset 0 -2px 0 #e8b040" : "none",
                }}
              >Agents</button>
              <button
                onClick={() => setSidebarTab("team")}
                style={{
                  flex: 1, padding: "8px 6px", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer",
                  backgroundColor: sidebarTab === "team" ? "#382800" : "#1a1530",
                  color: sidebarTab === "team" ? "#e8b040" : "#6a5848",
                  position: "relative",
                  fontFamily: "'Press Start 2P', monospace",
                  letterSpacing: "0.03em",
                  boxShadow: sidebarTab === "team" ? "inset 0 -2px 0 #e8b040" : "none",
                }}
              >
                Team
                {teamMessages.length > 0 && (
                  <span style={{
                    marginLeft: 5, fontSize: 8, padding: "1px 4px",
                    backgroundColor: "#48cc6a22", color: "#48cc6a",
                    border: "1px solid #48cc6a44",
                  }}>{teamMessages.length}</span>
                )}
              </button>
            </div>

            {/* Hire buttons */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setShowHireModal(true)}
                style={{
                  flex: 1, padding: "7px 6px",
                  border: "1px solid #e8b04060",
                  backgroundColor: "transparent", color: "#e8b040",
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'Press Start 2P', monospace",
                  letterSpacing: "0.03em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(200,155,48,0.12)"; e.currentTarget.style.borderColor = "#e8b040"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e8b04060"; }}
              >+ Hire</button>
              {hasTeam ? (<>
                {teamBusy && (
                  <button
                    onClick={handleStopTeam}
                    style={{
                      flex: 1, padding: "7px 6px",
                      border: "1px solid #e8903070",
                      backgroundColor: "transparent", color: "#e89030",
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'Press Start 2P', monospace",
                      letterSpacing: "0.03em",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(224,133,48,0.12)"; e.currentTarget.style.borderColor = "#e89030"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e8903070"; }}
                  >Stop</button>
                )}
                <button
                  onClick={handleFireTeam}
                  style={{
                    flex: 1, padding: "7px 6px",
                    border: "1px solid #e0484870",
                    backgroundColor: "transparent", color: "#e04848",
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'Press Start 2P', monospace",
                    letterSpacing: "0.03em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(212,68,68,0.12)"; e.currentTarget.style.borderColor = "#e04848"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e0484870"; }}
                >Fire Team</button>
              </>) : (
                <button
                  onClick={() => setShowHireTeamModal(true)}
                  style={{
                    flex: 1, padding: "7px 6px",
                    border: "1px solid #e8903070",
                    backgroundColor: "transparent", color: "#e89030",
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'Press Start 2P', monospace",
                    letterSpacing: "0.03em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(224,133,48,0.12)"; e.currentTarget.style.borderColor = "#e89030"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e8903070"; }}
                >+ Team</button>
              )}
            </div>
          </div>

          {/* Team Chat view (team tab) */}
          {sidebarTab === "team" && (
            <TeamChatView messages={teamMessages} agents={agents} assetsReady={assetsReady} />
          )}

          {/* Agent list — scrollable (agents tab) */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", display: sidebarTab === "agents" ? "block" : "none" }}>
            {agentList.map((agent) => {
              const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
              const isExpanded = chatOpen && selectedAgent === agent.agentId;
              const agentState = agents.get(agent.agentId);
              const busy = agentState?.status === "working" || agentState?.status === "waiting_approval";
              const isTeamMember = !!agentState?.teamId && !agentState?.isTeamLead;

              return (
                <div key={agent.agentId} style={{
                  display: "flex", flexDirection: "column",
                  borderBottom: "1px solid #272040",
                  borderLeft: agentState?.teamId ? "3px solid #e8b040" : "3px solid transparent",
                }}>
                  {/* Collapsed row — always visible */}
                  <button
                    onClick={() => {
                      if (isExpanded) {
                        setChatOpen(false);
                      } else {
                        setSelectedAgent(agent.agentId);
                        setChatOpen(true);
                      }
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px",
                      background: isExpanded ? "#272040" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "background-color 0.1s",
                      ...(isExpanded ? { position: "sticky" as const, top: 0, zIndex: 2, backgroundColor: "#272040" } : {}),
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = "#231e38"; }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <SpriteAvatar palette={agent.palette ?? 0} zoom={2} ready={assetsReady} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 4 }}>
                        {agent.name}
                        {agent.isTeamLead && (
                          <span style={{
                            fontSize: 8, padding: "1px 4px",
                            backgroundColor: "#e8903028", color: "#e89030",
                            border: "1px solid #e8903060", fontFamily: "monospace", letterSpacing: "0.05em",
                          }}>LEAD</span>
                        )}
                        {isTeamMember && (
                          <span style={{
                            fontSize: 8, padding: "1px 4px",
                            backgroundColor: "#e8b04020", color: "#e8b040",
                            border: "1px solid #e8b04050", fontFamily: "monospace", letterSpacing: "0.05em",
                          }}>TEAM</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a6858", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        {agent.role}
                        {agent.backend && (
                          <span style={{
                            fontSize: 8, padding: "1px 4px",
                            backgroundColor: (BACKEND_OPTIONS.find((b) => b.id === agent.backend)?.color ?? "#666") + "18",
                            color: BACKEND_OPTIONS.find((b) => b.id === agent.backend)?.color ?? "#666",
                            border: `1px solid ${(BACKEND_OPTIONS.find((b) => b.id === agent.backend)?.color ?? "#666")}40`,
                          }}>
                            {BACKEND_OPTIONS.find((b) => b.id === agent.backend)?.name ?? agent.backend}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, padding: "2px 5px",
                      backgroundColor: (agent.isTeamLead && agent.status === "done" ? "#48cc6a" : cfg.color) + "18",
                      color: agent.isTeamLead && agent.status === "done" ? "#48cc6a" : cfg.color,
                      border: `1px solid ${(agent.isTeamLead && agent.status === "done" ? "#48cc6a" : cfg.color)}40`,
                      flexShrink: 0, whiteSpace: "nowrap", fontFamily: "monospace",
                    }}>
                      {agent.isTeamLead && agent.status === "done"
                        ? "✓ Done"
                        : <>{agent.status === "done" ? "✓ " : agent.status === "working" ? "▶ " : ""}{cfg.label}</>
                      }
                    </span>
                    {!agentState?.teamId && (
                      <span
                        onClick={(e) => { e.stopPropagation(); handleFire(agent.agentId); }}
                        style={{
                          fontSize: 10, color: "#5a4838", cursor: "pointer", lineHeight: 1,
                          padding: "4px", flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#e04848"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#5a4838"; }}
                      >✕</span>
                    )}
                  </button>

                  {/* Expanded chat area */}
                  {isExpanded && agentState && (
                    <div style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      backgroundColor: "#1a1530",
                      minHeight: 0,
                      height: "calc(100vh - 200px)",
                      maxHeight: "calc(100vh - 160px)",
                      overflow: "hidden",
                    }}>
                      {/* Messages */}
                      <div style={{
                        flex: 1, overflowY: "auto", padding: "12px 14px",
                        display: "flex", flexDirection: "column",
                        minHeight: 0,
                      }}>
                        {agentState.messages.length === 0 && (
                          <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 12 }}>
                            {isTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                          </div>
                        )}

                        {agentState.messages.map((msg) => (
                          <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewUrl} isTeamLead={agentState?.isTeamLead} isTeamMember={isTeamMember} />
                        ))}

                        {busy && !agentState.pendingApproval && (
                          <ThinkingBubble logLine={agentState.lastLogLine} />
                        )}

                        {agentState.pendingApproval && (
                          <div style={{
                            marginBottom: 8, padding: 12,
                            backgroundColor: "#261a00",
                            border: "1px solid #e89030",
                          }}>
                            <div style={{ fontSize: 11, fontWeight: "bold", color: "#e89030", marginBottom: 6, fontFamily: "monospace" }}>
                              ▲ {agentState.pendingApproval.title}
                            </div>
                            <div style={{ fontSize: 12, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                              {agentState.pendingApproval.summary}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                                style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                              >▶ Approve</button>
                              <button
                                onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                                style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                              >✕ Reject</button>
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>

                      {/* Input / Cancel */}
                      <div style={{
                        padding: "8px 10px", borderTop: "1px solid #2e2448",
                        backgroundColor: "#1a1530", flexShrink: 0,
                      }}>
                        {isTeamMember ? (
                          <div style={{
                            textAlign: "center", color: "#5a4838", fontSize: 11, padding: "8px 0", fontFamily: "monospace",
                          }}>
                            Tasks are assigned by the Team Lead
                          </div>
                        ) : isAgentBusy ? (
                          <button
                            onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                            style={{
                              width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                              backgroundColor: "#3e1818", color: "#e04848", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                            }}
                          >✕ Cancel current work</button>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              value={prompt}
                              onChange={(e) => setPrompt(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                              placeholder="Send a message..."
                              style={{
                                flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                                backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                              }}
                              autoFocus
                            />
                            <button
                              onClick={handleRunTask}
                              disabled={!prompt.trim()}
                              style={{
                                padding: "9px 14px", border: "none",
                                backgroundColor: prompt.trim() ? "#e8b040" : "#272040",
                                color: prompt.trim() ? "#16122a" : "#5a4838",
                                fontSize: 12, cursor: prompt.trim() ? "pointer" : "default",
                                fontWeight: 700, fontFamily: "monospace",
                                transition: "background-color 0.1s",
                              }}
                            >Send</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Mobile: bottom agent bar ── */}
      {isMobile && agentList.length > 0 && !isChatExpanded && sidebarTab !== "team" && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          background: "linear-gradient(to top, rgba(22,18,42,0.95) 0%, rgba(22,18,42,0.7) 80%, transparent 100%)",
          overflowX: "auto",
        }}>
          {/* Hire button */}
          <button
            onClick={() => setShowHireModal(true)}
            style={{
              width: 44, height: 44, flexShrink: 0,
              border: "1px solid #e8b04060", backgroundColor: "rgba(200,155,48,0.12)",
              color: "#e8b040", fontSize: 20, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >+</button>
          {/* Team button */}
          <button
            onClick={() => setSidebarTab("team")}
            style={{
              width: 44, height: 44, flexShrink: 0,
              border: "1px solid #e8903070", backgroundColor: "rgba(224,133,48,0.12)",
              color: "#e89030", fontSize: 10, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "monospace",
            }}
          >Team</button>
          {agentList.map((agent) => {
            const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
            return (
              <button
                key={agent.agentId}
                onClick={() => { setSelectedAgent(agent.agentId); setChatOpen(true); }}
                style={{
                  position: "relative", flexShrink: 0,
                  width: 44, height: 44,
                  border: selectedAgent === agent.agentId ? "1px solid #e8b040" : "1px solid #3d2e54",
                  backgroundColor: "#1e1a30",
                  cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <SpriteAvatar palette={agent.palette ?? 0} zoom={1} ready={assetsReady} />
                <span style={{
                  position: "absolute", bottom: 2, right: 2,
                  width: 6, height: 6,
                  backgroundColor: cfg.color, border: "1px solid #1e1a30",
                }} />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Mobile: full-screen chat overlay ── */}
      {isMobile && isChatExpanded && (() => {
        const agentState = selectedAgent ? agents.get(selectedAgent) : null;
        if (!agentState) return null;
        const cfg = STATUS_CONFIG[agentState.status] ?? STATUS_CONFIG.idle;
        const busy = agentState.status === "working" || agentState.status === "waiting_approval";
        const mobileIsTeamMember = !!agentState.teamId && !agentState.isTeamLead;
        return (
          <div style={{
            position: "absolute", inset: 0, zIndex: 30,
            backgroundColor: "#1a1530",
            display: "flex", flexDirection: "column",
          }}>
            {/* Header */}
            <div
              onClick={() => setChatOpen(false)}
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid #2e2448",
                display: "flex", alignItems: "center", gap: 10,
                flexShrink: 0,
                backgroundColor: "#1e1a30",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 14, color: "#7a6858", marginRight: 4 }}>&larr;</span>
              <SpriteAvatar palette={agentState.palette ?? 0} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8", display: "flex", alignItems: "center", gap: 4 }}>
                  {agentState.name}
                  {agentState.isTeamLead && (
                    <span style={{ fontSize: 8, padding: "1px 4px", backgroundColor: "#e8903028", color: "#e89030", border: "1px solid #e8903060", fontFamily: "monospace" }}>LEAD</span>
                  )}
                  {mobileIsTeamMember && (
                    <span style={{ fontSize: 8, padding: "1px 4px", backgroundColor: "#e8b04020", color: "#e8b040", border: "1px solid #e8b04050", fontFamily: "monospace" }}>TEAM</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#7a6858" }}>{agentState.role}</div>
              </div>
              <span style={{
                fontSize: 9, padding: "2px 6px",
                backgroundColor: cfg.color + "18", color: cfg.color,
                border: `1px solid ${cfg.color}40`,
                flexShrink: 0, fontFamily: "monospace",
              }}>
                {cfg.label}
              </span>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "12px 14px",
              display: "flex", flexDirection: "column",
            }}>
              {agentState.messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 12, fontFamily: "monospace" }}>
                  {mobileIsTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                </div>
              )}

              {agentState.messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewUrl} isTeamLead={agentState.isTeamLead} isTeamMember={mobileIsTeamMember} />
              ))}

              {busy && !agentState.pendingApproval && (
                <ThinkingBubble logLine={agentState.lastLogLine} />
              )}

              {agentState.pendingApproval && (
                <div style={{
                  marginBottom: 8, padding: 12,
                  backgroundColor: "#261a00", border: "1px solid #e89030",
                }}>
                  <div style={{ fontSize: 11, fontWeight: "bold", color: "#e89030", marginBottom: 6, fontFamily: "monospace" }}>
                    ▲ {agentState.pendingApproval.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                    {agentState.pendingApproval.summary}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                    >▶ Approve</button>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                    >✕ Reject</button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input / Cancel */}
            <div style={{
              padding: "8px 10px", borderTop: "1px solid #2e2448",
              backgroundColor: "#1a1530", flexShrink: 0,
            }}>
              {mobileIsTeamMember ? (
                <div style={{
                  textAlign: "center", color: "#5a4838", fontSize: 11, padding: "8px 0", fontFamily: "monospace",
                }}>
                  Tasks are assigned by the Team Lead
                </div>
              ) : busy ? (
                <button
                  onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                  style={{
                    width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                    backgroundColor: "#3e1818", color: "#e04848", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                  }}
                >✕ Cancel current work</button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                    placeholder="Send a message..."
                    style={{
                      flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                      backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleRunTask}
                    disabled={!prompt.trim()}
                    style={{
                      padding: "9px 14px", border: "none",
                      backgroundColor: prompt.trim() ? "#e8b040" : "#272040",
                      color: prompt.trim() ? "#16122a" : "#5a4838",
                      fontSize: 12, cursor: prompt.trim() ? "pointer" : "default",
                      fontWeight: 700, fontFamily: "monospace",
                    }}
                  >Send</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Mobile: Team chat fullscreen overlay */}
      {isMobile && sidebarTab === "team" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 30,
          backgroundColor: "#1a1530",
          display: "flex", flexDirection: "column",
        }}>
          <div
            onClick={() => setSidebarTab("agents")}
            style={{
              padding: "12px 14px", borderBottom: "1px solid #2e2448",
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
              backgroundColor: "#1e1a30", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 14, color: "#7a6858", marginRight: 4 }}>&larr;</span>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>Team Chat</div>
            <span style={{ fontSize: 10, color: "#7a6858", fontFamily: "monospace" }}>{teamMessages.length} messages</span>
          </div>
          <TeamChatView messages={teamMessages} agents={agents} assetsReady={assetsReady} />
        </div>
      )}

      {showHireModal && (
        <HireModal onHire={handleHire} onClose={() => setShowHireModal(false)} assetsReady={assetsReady} />
      )}

      {showHireTeamModal && (
        <HireTeamModal onCreateTeam={handleCreateTeam} onClose={() => setShowHireTeamModal(false)} assetsReady={assetsReady} />
      )}

      {officeStateRef.current && (
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          layout={officeStateRef.current.layout}
          onImportLayout={handleImportLayout}
          soundEnabled={soundEnabled}
          onSoundEnabledChange={setSoundEnabled}
        />
      )}

      {previewUrl && <PreviewOverlay url={previewUrl} onClose={() => setPreviewUrl(null)} />}

      {showConfetti && <ConfettiOverlay />}
      {celebration && (
        <CelebrationModal
          previewUrl={celebration.previewUrl}
          previewPath={celebration.previewPath}
          onPreview={(url) => { setPreviewUrl(url); setCelebration(null); setShowConfetti(false); }}
          onDismiss={() => { setCelebration(null); setShowConfetti(false); }}
        />
      )}
      {confirmModal}
    </div>
  );
}
