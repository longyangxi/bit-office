"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOfficeStore } from "@/store/office-store";
import type { ChatMessage, TeamChatMessage, TeamPhaseState } from "@/store/office-store";
import { connect, sendCommand } from "@/lib/connection";
import { getConnection } from "@/lib/storage";
import { nanoid } from "nanoid";
import ReactMarkdown from "react-markdown";
import type { AgentDefinition } from "@office/shared";
import { getCharacterThumbnail } from "@/components/office/sprites/spriteData";
import { OfficeState } from "@/components/office/engine/officeState";
import { EditorState } from "@/components/office/editor/editorState";
import { EditTool } from "@/components/office/types";
import { ZOOM_MIN, ZOOM_MAX } from "@/components/office/constants";
import { useEditorActions, loadLayoutFromStorage, saveLayoutToStorage } from "@/hooks/useEditorActions";
import { useEditorKeyboard } from "@/hooks/useEditorKeyboard";
import { migrateLayoutColors } from "@/components/office/layout/layoutSerializer";
import type { SceneAdapter } from "@/components/office/scene/SceneAdapter";
import { useSceneBridge } from "@/components/office/scene/useSceneBridge";
import dynamic from "next/dynamic";
const PixelOfficeScene = dynamic(() => import("@/components/office/scene/PixelOfficeScene"), { ssr: false });
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

/** Build a SERVE_PREVIEW command from result fields */
function buildPreviewCommand(result: { previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string }) {
  if (result.previewCmd && result.previewPort) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: result.previewCmd, previewPort: result.previewPort, cwd: result.projectDir };
  }
  if (result.previewPath) {
    return { type: "SERVE_PREVIEW" as const, filePath: result.previewPath };
  }
  // Desktop/CLI app: PREVIEW_CMD without port, or non-HTML entry file
  if (result.previewCmd) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: result.previewCmd, cwd: result.projectDir };
  }
  if (result.entryFile && !/\.html?$/i.test(result.entryFile)) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: result.entryFile, cwd: result.projectDir };
  }
  return null;
}

function CelebrationModal({ previewUrl, previewPath, onPreview, onDismiss, previewCmd, previewPort, projectDir, entryFile }: {
  previewUrl?: string;
  previewPath?: string;
  previewCmd?: string;
  previewPort?: number;
  projectDir?: string;
  entryFile?: string;
  onPreview: (url: string) => void;
  onDismiss: () => void;
}) {
  // Desktop/CLI app: has a launch command but no browser preview URL
  const canLaunch = !previewUrl && buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
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
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
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
          {canLaunch && (
            <button
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                onDismiss();
              }}
              style={{
                padding: "9px 20px", border: "1px solid #5aacff",
                backgroundColor: "#0f1e3a", color: "#5aacff",
                fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              }}
            >
              ▶ Launch
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
            display: "flex", alignItems: "center", gap: 8,
            whiteSpace: "pre-wrap", wordBreak: "break-all",
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
        fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all",
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
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#818cf8", textDecoration: "underline", wordBreak: "break-all" }}>{children}</a>;
  },
  strong({ children }) {
    return <strong style={{ color: "#f0f0f0" }}>{children}</strong>;
  },
};

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function TokenBadge({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }) {
  if (inputTokens === 0 && outputTokens === 0) return null;
  return (
    <span style={{
      fontSize: 8, padding: "1px 4px",
      backgroundColor: "#48cc6a18", color: "#48cc6a",
      border: "1px solid #48cc6a40", fontFamily: "monospace",
      whiteSpace: "nowrap",
    }} title={`Input: ${inputTokens.toLocaleString()} / Output: ${outputTokens.toLocaleString()}`}>
      {"\u2191"}{formatTokenCount(inputTokens)} {"\u2193"}{formatTokenCount(outputTokens)}
    </span>
  );
}

function MdContent({ text }: { text: string }) {
  return (
    <ReactMarkdown urlTransform={(url) => url} components={mdComponents}>
      {text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)')}
    </ReactMarkdown>
  );
}

function MessageBubble({ msg, onPreview, isTeamLead, isTeamMember, teamPhase }: { msg: ChatMessage; onPreview?: (url: string) => void; isTeamLead?: boolean; isTeamMember?: boolean; teamPhase?: string | null }) {
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

  // Detect [PLAN]...[/PLAN] blocks
  const planMatch = msg.text.match(/\[PLAN\]([\s\S]*?)\[\/PLAN\]/i);
  const planContent = planMatch?.[1]?.trim();
  const textWithoutPlan = planContent ? msg.text.replace(/\[PLAN\][\s\S]*?\[\/PLAN\]/i, "").trim() : null;

  // ── Completion Card: fixed-format delivery for team lead isFinalResult ──
  if (isTeamLead && msg.isFinalResult && msg.result) {
    const r = msg.result;
    // Strip structured markers from the summary for display
    const cleanSummary = r.summary
      .replace(/ENTRY_FILE:\s*.+/gi, "")
      .replace(/PROJECT_DIR:\s*.+/gi, "")
      .replace(/SUMMARY:\s*/gi, "")
      .trim();
    const entryFile = r.entryFile ?? r.summary.match(/ENTRY_FILE:\s*(.+)/i)?.[1]?.trim();
    const projectDir = r.projectDir ?? r.summary.match(/PROJECT_DIR:\s*(.+)/i)?.[1]?.trim();

    // Build file tree from changedFiles
    const changedFiles = r.changedFiles ?? [];

    return (
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
        <div style={{
          maxWidth: "90%", width: "100%",
          border: "2px solid #48cc6a",
          backgroundColor: "#0a1f12",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "10px 14px",
            backgroundColor: "#143a14",
            borderBottom: "1px solid #48cc6a40",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>✓</span>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#48cc6a",
              fontFamily: "monospace", letterSpacing: "0.08em",
            }}>PROJECT DELIVERED</span>
          </div>

          {/* Summary */}
          <div style={{ padding: "12px 14px" }} className="chat-markdown">
            <div style={{ color: "#d8c8a8", fontSize: 13, lineHeight: 1.6 }}>
              <MdContent text={cleanSummary || "Project completed successfully."} />
            </div>
          </div>

          {/* Project info */}
          {(projectDir || entryFile) && (
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid #48cc6a20",
              display: "flex", gap: 16, flexWrap: "wrap",
            }}>
              {projectDir && (
                <div style={{ fontSize: 11, fontFamily: "monospace" }}>
                  <span style={{ color: "#7a8a6a" }}>Directory: </span>
                  <span style={{ color: "#e8b040" }}>{projectDir}</span>
                </div>
              )}
              {entryFile && (
                <div style={{ fontSize: 11, fontFamily: "monospace" }}>
                  <span style={{ color: "#7a8a6a" }}>Entry: </span>
                  <span
                    style={{ color: "#e8b040", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => sendCommand({ type: "OPEN_FILE", path: entryFile })}
                  >{entryFile}</span>
                </div>
              )}
            </div>
          )}

          {/* Changed files */}
          {changedFiles.length > 0 && (
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid #48cc6a20",
            }}>
              <div style={{ fontSize: 10, color: "#7a8a6a", marginBottom: 4, fontFamily: "monospace" }}>
                {changedFiles.length} FILES
              </div>
              {changedFiles.slice(0, 8).map((f, i) => (
                <div key={i} style={{
                  fontSize: 11, fontFamily: "monospace", color: "#b8a878",
                  padding: "1px 0",
                }}>{f}</div>
              ))}
              {changedFiles.length > 8 && (
                <div style={{ fontSize: 10, color: "#5a4838", fontFamily: "monospace" }}>
                  ...and {changedFiles.length - 8} more
                </div>
              )}
            </div>
          )}

          {/* Preview button — for web projects (has previewUrl) */}
          {r.previewUrl && onPreview && (
            <div style={{
              padding: "10px 14px",
              borderTop: "1px solid #48cc6a20",
            }}>
              <button
                onClick={() => {
                  const cmd = buildPreviewCommand(r);
                  if (cmd) sendCommand(cmd);
                  onPreview(r.previewUrl!);
                }}
                style={{
                  width: "100%", padding: "10px 16px",
                  backgroundColor: "#143a14", color: "#48cc6a",
                  border: "1px solid #48cc6a50", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, fontFamily: "monospace",
                }}
              >
                ▶ Preview Result
              </button>
            </div>
          )}
          {/* Launch button — for desktop/CLI apps (no previewUrl but has a runnable command) */}
          {!r.previewUrl && buildPreviewCommand(r) && (
            <div style={{
              padding: "10px 14px",
              borderTop: "1px solid #48cc6a20",
            }}>
              <button
                onClick={() => {
                  const cmd = buildPreviewCommand(r);
                  if (cmd) sendCommand(cmd);
                }}
                style={{
                  width: "100%", padding: "10px 16px",
                  backgroundColor: "#0f1e3a", color: "#5aacff",
                  border: "1px solid #5aacff50", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, fontFamily: "monospace",
                }}
              >
                ▶ Launch App
              </button>
            </div>
          )}

          {/* Footer prompt */}
          <div style={{
            padding: "8px 14px",
            borderTop: "1px solid #48cc6a20",
            fontSize: 11, color: "#5a7a5a", fontFamily: "monospace",
          }}>
            Send feedback to request changes, or End Project to start fresh.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{
        maxWidth: "85%", padding: "8px 12px",
        backgroundColor: "#231e38", color: "#d8c8a8", fontSize: 13,
        wordBreak: "break-word", overflow: "hidden", minWidth: 0,
        border: "1px solid #3d2e54",
        borderLeft: "2px solid #3d2e54",
      }} className="chat-markdown">
        {planContent ? (
          <>
            {textWithoutPlan && <MdContent text={textWithoutPlan} />}
            <div style={{
              marginTop: textWithoutPlan ? 8 : 0,
              padding: "10px 12px",
              border: "2px solid #e8b040",
              backgroundColor: "#261a00",
              borderRadius: 0,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#e8b040",
                fontFamily: "monospace", letterSpacing: "0.1em",
                marginBottom: 8,
              }}>PROJECT PLAN</div>
              <div style={{ color: "#eddcb8", fontSize: 12 }}>
                <MdContent text={planContent} />
              </div>
            </div>
          </>
        ) : (
          <MdContent text={expanded && msg.result?.fullOutput ? msg.result.fullOutput : msg.text} />
        )}
        {hasFullOutput && !planContent && (
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
        {msg.result && msg.result.changedFiles.length > 0 && !planContent && (
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
        {/* Preview: for solo agents (non-team-lead), show based on result data */}
        {msg.result?.previewUrl && onPreview
          && !isTeamMember && !isTeamLead
        && (
          <button
            onClick={() => {
              const cmd = buildPreviewCommand(msg.result!);
              if (cmd) sendCommand(cmd);
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

const PERSONALITY_PRESETS = [
  { label: "Friendly & Casual", value: "You speak in a friendly, casual, encouraging, and natural tone." },
  { label: "Professional & Concise", value: "You speak formally, professionally, in an organized and concise manner." },
  { label: "Aggressive & Fast", value: "You are aggressive, action-first, always pursuing speed and efficiency." },
  { label: "Patient Mentor", value: "You teach patiently, explain the reasoning, and guide like a mentor." },
];

const ROLE_PRESETS = [
  "Frontend Dev", "Backend Dev", "Fullstack Dev", "Game Dev",
  "Data Scientist", "DevOps Engineer", "Mobile Dev", "UI/UX Designer", "QA Engineer",
] as const;

const SKILLS_MAP: Record<string, string[]> = {
  "Frontend Dev":    ["React", "Next.js", "CSS", "TypeScript", "Vue", "Tailwind", "HTML", "Webpack"],
  "Backend Dev":     ["Node.js", "Python", "APIs", "Database", "SQL", "Redis", "GraphQL", "Docker"],
  "Fullstack Dev":   ["React", "Node.js", "TypeScript", "APIs", "Database", "CSS", "Next.js", "Docker"],
  "Game Dev":        ["PixiJS", "Three.js", "Canvas", "Pygame", "WebGL", "Unity", "Godot", "TypeScript", "Physics"],
  "Data Scientist":  ["Python", "Pandas", "ML", "TensorFlow", "Data Viz", "Jupyter", "NumPy", "SQL"],
  "DevOps Engineer": ["Docker", "K8s", "CI/CD", "AWS", "Terraform", "Linux", "Monitoring", "Bash"],
  "Mobile Dev":      ["React Native", "Swift", "Kotlin", "Flutter", "iOS", "Android", "TypeScript", "Expo"],
  "UI/UX Designer":  ["Figma", "CSS", "Design Systems", "Prototyping", "Animation", "Accessibility", "Tailwind"],
  "QA Engineer":     ["Testing", "Cypress", "Jest", "Playwright", "Automation", "CI/CD", "Performance", "A11y"],
};

function CreateAgentModal({ onSave, onClose, assetsReady, editAgent }: {
  onSave: (agent: AgentDefinition) => void;
  onClose: () => void;
  assetsReady?: boolean;
  editAgent?: AgentDefinition | null;
}) {
  const [palette, setPalette] = useState(editAgent?.palette ?? 0);
  const [name, setName] = useState(editAgent?.name ?? "");

  // Role: preset index (-1 = custom)
  const [rolePresetIndex, setRolePresetIndex] = useState<number>(() => {
    if (!editAgent?.role) return 0;
    const idx = ROLE_PRESETS.indexOf(editAgent.role as typeof ROLE_PRESETS[number]);
    return idx >= 0 ? idx : -1;
  });
  const [customRole, setCustomRole] = useState(() => {
    if (!editAgent?.role) return "";
    const idx = ROLE_PRESETS.indexOf(editAgent.role as typeof ROLE_PRESETS[number]);
    return idx >= 0 ? "" : editAgent.role;
  });

  // Skills: set of selected tags
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => {
    if (!editAgent?.skills) return new Set(SKILLS_MAP[ROLE_PRESETS[0]]?.slice(0, 4) ?? []);
    return new Set(editAgent.skills.split(",").map((s) => s.trim()).filter(Boolean));
  });
  const [customSkillInput, setCustomSkillInput] = useState("");

  const currentRole = rolePresetIndex >= 0 ? ROLE_PRESETS[rolePresetIndex] : customRole.trim();
  const suggestedSkills = rolePresetIndex >= 0 ? (SKILLS_MAP[ROLE_PRESETS[rolePresetIndex]] ?? []) : [];

  const handleRoleChange = (idx: number) => {
    setRolePresetIndex(idx);
    if (idx >= 0) {
      const preset = ROLE_PRESETS[idx];
      const suggested = SKILLS_MAP[preset] ?? [];
      // Auto-select first 4 if no matching skills already selected
      const hasMatching = suggested.some((s) => selectedSkills.has(s));
      if (!hasMatching) {
        setSelectedSkills(new Set(suggested.slice(0, 4)));
      }
    }
  };

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const addCustomSkill = () => {
    const skill = customSkillInput.trim();
    if (skill && !selectedSkills.has(skill)) {
      setSelectedSkills((prev) => new Set(prev).add(skill));
      setCustomSkillInput("");
    }
  };

  const [personalityMode, setPersonalityMode] = useState<number>(() => {
    if (!editAgent) return 0;
    const idx = PERSONALITY_PRESETS.findIndex((p) => p.value === editAgent.personality);
    return idx >= 0 ? idx : 4; // 4 = custom
  });
  const [customPersonality, setCustomPersonality] = useState(editAgent?.personality ?? "");

  const currentPersonality = personalityMode < 4
    ? PERSONALITY_PRESETS[personalityMode].value
    : customPersonality;

  const handleSave = () => {
    if (!name.trim()) return;
    const id = editAgent
      ? editAgent.id
      : (name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "agent") + `-${nanoid(4)}`;
    onSave({
      id,
      name: name.trim(),
      role: currentRole,
      skills: Array.from(selectedSkills).join(", "),
      personality: currentPersonality,
      palette,
      isBuiltin: editAgent?.isBuiltin ?? false,
      teamRole: editAgent?.teamRole ?? "dev",
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1e1a30", padding: "18px 18px 14px",
          width: "90%", maxWidth: 400, border: "2px solid #3d2e54",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 13, margin: "0 0 12px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>
          {editAgent ? "Edit Agent" : "Create Agent"}
        </h2>

        {/* Avatar palette selector */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>AVATAR</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                onClick={() => setPalette(p)}
                style={{
                  padding: 3, border: palette === p ? "2px solid #e8b040" : "2px solid #3d2e54",
                  backgroundColor: palette === p ? "#382800" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <SpriteAvatar palette={p} zoom={2} ready={assetsReady} />
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>NAME</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
            style={{
              width: "100%", padding: "7px 10px", fontSize: 13, fontFamily: "monospace",
              border: "1px solid #3d2e54", backgroundColor: "#14112a", color: "#eddcb8",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Role */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>ROLE</div>
          <select
            value={rolePresetIndex}
            onChange={(e) => handleRoleChange(Number(e.target.value))}
            style={{
              width: "100%", padding: "7px 10px", fontSize: 13, fontFamily: "monospace",
              border: "1px solid #3d2e54", backgroundColor: "#14112a", color: "#eddcb8",
              boxSizing: "border-box", cursor: "pointer",
            }}
          >
            {ROLE_PRESETS.map((r, i) => (
              <option key={r} value={i}>{r}</option>
            ))}
            <option value={-1}>Custom...</option>
          </select>
          {rolePresetIndex === -1 && (
            <input
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              placeholder="e.g. Python Expert"
              style={{
                width: "100%", padding: "7px 10px", fontSize: 13, fontFamily: "monospace",
                border: "1px solid #3d2e54", backgroundColor: "#14112a", color: "#eddcb8",
                boxSizing: "border-box", marginTop: 4,
              }}
            />
          )}
        </div>

        {/* Skills */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>SKILLS</div>
          {/* Suggested skill chips */}
          {suggestedSkills.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {suggestedSkills.map((skill) => {
                const active = selectedSkills.has(skill);
                return (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    style={{
                      padding: "4px 10px", fontSize: 12, fontFamily: "monospace",
                      border: active ? "1px solid #e8b04080" : "1px solid #3d2e54",
                      backgroundColor: active ? "#382800" : "transparent",
                      color: active ? "#e8b040" : "#7a6858",
                      cursor: "pointer",
                    }}
                  >{skill}</button>
                );
              })}
            </div>
          )}
          {/* Custom-added skills (not in suggested) */}
          {(() => {
            const customTags = Array.from(selectedSkills).filter((s) => !suggestedSkills.includes(s));
            if (customTags.length === 0) return null;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {customTags.map((skill) => (
                  <span
                    key={skill}
                    style={{
                      padding: "4px 10px", fontSize: 12, fontFamily: "monospace",
                      border: "1px solid #5aacff60", backgroundColor: "#182844",
                      color: "#5aacff", display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {skill}
                    <span
                      onClick={() => toggleSkill(skill)}
                      style={{ cursor: "pointer", fontSize: 14, lineHeight: 1, color: "#5aacff80" }}
                    >&times;</span>
                  </span>
                ))}
              </div>
            );
          })()}
          {/* Add custom skill */}
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={customSkillInput}
              onChange={(e) => setCustomSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomSkill(); } }}
              placeholder="Add custom skill..."
              style={{
                flex: 1, padding: "6px 10px", fontSize: 12, fontFamily: "monospace",
                border: "1px solid #3d2e54", backgroundColor: "#14112a", color: "#eddcb8",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={addCustomSkill}
              style={{
                padding: "5px 12px", fontSize: 14, fontWeight: 700,
                border: "1px solid #3d2e54", backgroundColor: "transparent",
                color: "#7a6858", cursor: "pointer", fontFamily: "monospace",
              }}
            >+</button>
          </div>
        </div>

        {/* Personality */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>PERSONALITY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {PERSONALITY_PRESETS.map((p, i) => (
              <label
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                  cursor: "pointer", fontSize: 12, color: personalityMode === i ? "#eddcb8" : "#7a6858",
                  fontFamily: "monospace",
                }}
              >
                <input
                  type="radio"
                  name="personality"
                  checked={personalityMode === i}
                  onChange={() => setPersonalityMode(i)}
                  style={{ accentColor: "#e8b040", cursor: "pointer" }}
                />
                {p.label}
              </label>
            ))}
            <label
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                cursor: "pointer", fontSize: 12, color: personalityMode === 4 ? "#eddcb8" : "#7a6858",
                fontFamily: "monospace",
              }}
            >
              <input
                type="radio"
                name="personality"
                checked={personalityMode === 4}
                onChange={() => setPersonalityMode(4)}
                style={{ accentColor: "#e8b040", cursor: "pointer" }}
              />
              Custom
            </label>
            {personalityMode === 4 && (
              <textarea
                value={customPersonality}
                onChange={(e) => setCustomPersonality(e.target.value)}
                placeholder="Describe the personality..."
                rows={2}
                style={{
                  width: "100%", padding: "7px 10px", fontSize: 12, fontFamily: "monospace",
                  border: "1px solid #3d2e54", backgroundColor: "#14112a", color: "#eddcb8",
                  resize: "vertical", boxSizing: "border-box", marginTop: 2,
                }}
              />
            )}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleSave}
            style={{
              flex: 1, padding: "9px", border: "1px solid #e8b04060",
              backgroundColor: "#382800", color: "#e8b040", fontSize: 13,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              opacity: name.trim() ? 1 : 0.4,
            }}
            disabled={!name.trim()}
          >
            {editAgent ? "Save" : "Create"}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              border: "1px solid #3d2e54", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function HireModal({ agentDefs, onHire, onCreate, onEdit, onDelete, onClose, assetsReady }: {
  agentDefs: AgentDefinition[];
  onHire: (def: AgentDefinition, backend: string) => void;
  onCreate: () => void;
  onEdit: (def: AgentDefinition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Leaders can only work in teams, not as solo agents
  const builtinAgents = agentDefs.filter((a) => a.isBuiltin && a.teamRole !== "leader");
  const customAgents = agentDefs.filter((a) => !a.isBuiltin && a.teamRole !== "leader");

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
          backgroundColor: "#1e1a30", padding: "18px 18px 14px",
          width: "90%", maxWidth: 420, border: "2px solid #3d2e54",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 13, margin: "0 0 14px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Agent</h2>

        {/* Backend selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>AI BACKEND</div>
          <div style={{ display: "flex", gap: 4 }}>
            {BACKEND_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBackend(b.id)}
                style={{
                  flex: 1, padding: "6px 4px", fontSize: 12, fontWeight: 600,
                  border: selectedBackend === b.id ? `1px solid ${b.color}` : "1px solid #3d2e54",
                  backgroundColor: selectedBackend === b.id ? b.color + "20" : "transparent",
                  color: selectedBackend === b.id ? b.color : "#6a5848",
                  cursor: "pointer", fontFamily: "monospace",
                }}
              >{b.name}</button>
            ))}
          </div>
        </div>

        {/* Built-in agents */}
        <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>BUILT-IN AGENTS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
          {builtinAgents.map((def) => (
            <button
              key={def.id}
              onClick={() => onHire(def, selectedBackend)}
              onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
              onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#3d2e54"; }}
              title={def.skills ? `Skills: ${def.skills}` : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "12px 6px 10px", position: "relative",
                border: "1px solid #3d2e54", backgroundColor: "transparent",
                cursor: "pointer", textAlign: "center",
                transition: "border-color 0.15s",
              }}
            >
              <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
              <div style={{ fontSize: 13, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
              <div style={{ fontSize: 11, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
              {hoveredId === def.id && (
                <span
                  onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                  style={{ position: "absolute", top: 4, right: 4, fontSize: 14, color: "#7a6858", cursor: "pointer", padding: "2px 4px" }}
                  title="Edit"
                >&#9998;</span>
              )}
            </button>
          ))}
        </div>

        {/* Custom agents */}
        {customAgents.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>MY AGENTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
              {customAgents.map((def) => (
                <button
                  key={def.id}
                  onClick={() => onHire(def, selectedBackend)}
                  onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
                  onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#3d2e54"; }}
                  title={def.skills ? `Skills: ${def.skills}` : undefined}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "12px 6px 10px", position: "relative",
                    border: "1px solid #3d2e54", backgroundColor: "transparent",
                    cursor: "pointer", textAlign: "center",
                    transition: "border-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 11, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  {hoveredId === def.id && (
                    <span style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2, alignItems: "center" }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                        style={{ fontSize: 14, color: "#7a6858", cursor: "pointer", padding: "2px 4px" }}
                        title="Edit"
                      >&#9998;</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                        style={{ fontSize: 15, color: "#e04848", cursor: "pointer", padding: "2px 4px", fontWeight: 700 }}
                        title="Delete"
                      >&times;</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Create + Cancel */}
        <button
          onClick={onCreate}
          style={{
            width: "100%", marginBottom: 5, padding: "9px",
            border: "1px solid #e8b04060", backgroundColor: "transparent",
            color: "#e8b040", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
          }}
        >+ Create Agent</button>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "9px",
            border: "1px solid #3d2e54", backgroundColor: "transparent",
            color: "#6a5848", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
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

/** Shared card component for team activity messages (used by both toast and log) */
function TeamActivityCard({ msg, agents, assetsReady, maxChars = 150, shadow }: {
  msg: TeamChatMessage;
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
  maxChars?: number;
  shadow?: boolean;
}) {
  const cfg = TEAM_MSG_COLORS[msg.messageType] ?? TEAM_MSG_COLORS.status;
  const fromAgent = agents.get(msg.fromAgentId);
  const toAgent = msg.toAgentId ? agents.get(msg.toAgentId) : undefined;
  const msgText = msg.message ?? "";

  return (
    <div style={{
      padding: "8px 10px",
      backgroundColor: cfg.bg, borderLeft: `2px solid ${cfg.border}`,
      border: `1px solid ${cfg.border}40`,
      boxShadow: shadow ? "0 2px 12px rgba(0,0,0,0.5)" : undefined,
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
        maxHeight: 80, overflow: "hidden", fontFamily: "monospace",
      }}>
        {msgText.slice(0, maxChars)}{msgText.length > maxChars ? "..." : ""}
      </div>
    </div>
  );
}

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
      width: 300, maxWidth: "40vw",
      transform: sliding ? "translateX(0)" : "translateX(calc(100% + 16px))",
      opacity: sliding ? 1 : 0,
      transition: "transform 0.35s ease, opacity 0.35s ease",
      pointerEvents: "none",
    }}>
      <TeamActivityCard msg={visible} agents={agents} assetsReady={assetsReady} maxChars={120} shadow />
    </div>
  );
}

function TeamActivityLog({ messages, agents, assetsReady, onClear }: {
  messages: TeamChatMessage[];
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
  onClear?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, collapsed]);

  return (
    <div style={{
      borderTop: "1px solid #2e2448",
      padding: "6px 0",
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: "4px 12px 6px",
          fontSize: 9, color: "#6a5848", fontFamily: "monospace",
          letterSpacing: "0.05em", textTransform: "uppercase",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ width: 10, textAlign: "center" }}>{collapsed ? "▶" : "▼"}</span>
        Activity ({messages.length})
        {onClear && (
          <span
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            style={{
              marginLeft: "auto", fontSize: 8, padding: "1px 5px",
              color: "#7a6858", border: "1px solid #3d2e5480",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#e04848"; e.currentTarget.style.borderColor = "#e0484880"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#7a6858"; e.currentTarget.style.borderColor = "#3d2e5480"; }}
          >CLEAR</span>
        )}
      </div>
      {!collapsed && (
        <div style={{ overflowY: "auto", padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {messages.map((msg, i) => {
            if (!msg || !msg.fromAgentId) return null;
            return (
              <TeamActivityCard key={msg.id ?? `tc-${i}`} msg={msg} agents={agents} assetsReady={assetsReady} />
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

function HireTeamModal({ agentDefs, onCreateTeam, onClose, assetsReady }: {
  agentDefs: AgentDefinition[];
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  const [selectedDevId, setSelectedDevId] = useState<string>(devAgents[0]?.id ?? "");
  const [backends, setBackends] = useState<Record<string, string>>({});

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [];
    if (selectedDevId) memberIds.push(selectedDevId);
    if (reviewer) memberIds.push(reviewer.id);
    onCreateTeam(leader.id, memberIds, backends);
  };

  // Fixed rows (leader + reviewer) + toggleable dev rows
  const fixedRows: { def: AgentDefinition; label: string }[] = [];
  if (leader) fixedRows.push({ def: leader, label: "LEAD" });
  if (reviewer) fixedRows.push({ def: reviewer, label: "REVIEWER" });

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
          backgroundColor: "#1e1a30", padding: "18px 18px 14px",
          width: "90%", maxWidth: 440, border: "2px solid #3d2e54",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 13, margin: "0 0 14px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Team</h2>

        <div style={{ fontSize: 11, color: "#7a6858", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          {/* Fixed rows: leader and reviewer */}
          {fixedRows.map(({ def, label }) => (
            <div
              key={def.id}
              title={def.skills ? `Skills: ${def.skills}` : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                border: "1px solid #e8903070",
                backgroundColor: "#261a00",
                textAlign: "left",
              }}
            >
              <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8" }}>
                  {def.name} <span style={{ color: "#e89030", fontSize: 10, fontFamily: "monospace" }}>{label}</span>
                </div>
                <div style={{ fontSize: 12, color: "#7a6858" }}>{def.role}</div>
              </div>
              <select
                value={backends[def.id] ?? "claude"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
                style={{
                  padding: "3px 6px", border: "1px solid #3d2e54",
                  backgroundColor: "#1a1530", color: "#9a8a68", fontSize: 11, cursor: "pointer", fontFamily: "monospace",
                }}
              >
                {BACKEND_OPTIONS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ))}

          {/* Dev cards — single select grid */}
          <div style={{ fontSize: 11, color: "#7a6858", marginTop: 4, marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>DEV AGENT (pick 1)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
            {devAgents.map((def) => {
              const selected = selectedDevId === def.id;
              return (
                <button
                  key={def.id}
                  onClick={() => setSelectedDevId(def.id)}
                  title={def.skills ? `Skills: ${def.skills}` : undefined}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "12px 6px 10px",
                    border: selected ? "1px solid #e8b04060" : "1px solid #3d2e54",
                    backgroundColor: selected ? "#2a2200" : "transparent",
                    cursor: "pointer", textAlign: "center",
                    opacity: selected ? 1 : 0.5,
                    transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 11, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  <select
                    value={backends[def.id] ?? "claude"}
                    onClick={(e) => { e.stopPropagation(); setSelectedDevId(def.id); }}
                    onChange={(e) => { setSelectedDevId(def.id); setBackends((prev) => ({ ...prev, [def.id]: e.target.value })); }}
                    style={{
                      marginTop: 6, padding: "3px 6px", border: "1px solid #3d2e54",
                      backgroundColor: "#1a1530", color: "#9a8a68", fontSize: 11, cursor: "pointer", fontFamily: "monospace",
                    }}
                  >
                    {BACKEND_OPTIONS.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleCreate}
            style={{
              flex: 1, padding: "9px", border: "1px solid #e8b04060",
              backgroundColor: "#382800", color: "#e8b040", fontSize: 13,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              opacity: leader ? 1 : 0.4,
            }}
            disabled={!leader}
          >Create Team</button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              border: "1px solid #3d2e54", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function OfficePage() {
  const router = useRouter();
  const { agents, connected, addUserMessage, teamMessages, clearTeamMessages, teamPhases, agentDefs } = useOfficeStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ previewUrl?: string; previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const { confirm, modal: confirmModal } = useConfirm();
  const [showHireModal, setShowHireModal] = useState(false);
  const [showHireTeamModal, setShowHireTeamModal] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTeamOpen, setMobileTeamOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"team" | "agents" | "external">("team");
  const [prompt, setPrompt] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Editor state
  const [editMode, setEditMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [, forceUpdate] = useState(0);
  const editorRef = useRef(new EditorState());
  const officeStateRef = useRef<OfficeState | null>(null);
  const [sceneAdapter, setSceneAdapter] = useState<SceneAdapter | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [assetsReady, setAssetsReady] = useState(false);

  // Bridge store → scene adapter
  useSceneBridge(sceneAdapter, selectedAgent);

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
        setCelebration({ previewUrl: r.previewUrl, previewPath: r.previewPath, previewCmd: r.previewCmd, previewPort: r.previewPort, projectDir: r.projectDir, entryFile: r.entryFile });
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
    handleImportTiledMap,
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

  const handleAdapterReady = useCallback((adapter: SceneAdapter) => {
    setSceneAdapter(adapter);
  }, []);

  useEffect(() => {
    const conn = getConnection();
    if (!conn) {
      router.push("/pair");
      return;
    }
    useOfficeStore.getState().hydrate();
    const scopedDisconnect = connect(conn);
    return scopedDisconnect;
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

  const handleHire = useCallback((def: AgentDefinition, backend: string) => {
    const existing = Array.from(agents.values()).filter(
      (a) => a.name === def.name || a.name.match(new RegExp(`^${def.name} \\d+$`))
    );
    const displayName = existing.length === 0 ? def.name : `${def.name} ${existing.length + 1}`;
    const agentId = `agent-${nanoid(6)}`;
    sendCommand({ type: "CREATE_AGENT", agentId, name: displayName, role: def.skills ? `${def.role} — ${def.skills}` : def.role, palette: def.palette, personality: def.personality, backend });
    setSelectedAgent(agentId);
    setChatOpen(true);
    setShowHireModal(false);
  }, [agents]);

  const handleCreateTeam = useCallback((leadId: string, memberIds: string[], backends: Record<string, string>) => {
    sendCommand({ type: "CREATE_TEAM", leadId, memberIds, backends });
    setShowHireTeamModal(false);
    setExpandedSection("team");
    setSelectedAgent(null);
    setChatOpen(false);
    setMobileTeamOpen(true);
  }, []);

  const handleSaveAgentDef = useCallback((def: AgentDefinition) => {
    sendCommand({ type: "SAVE_AGENT_DEF", agent: def });
    setShowCreateAgent(false);
    setEditingAgent(null);
  }, []);

  const handleDeleteAgentDef = useCallback((agentDefId: string) => {
    sendCommand({ type: "DELETE_AGENT_DEF", agentDefId });
  }, []);

  const handleFire = useCallback(async (agentId: string) => {
    const agent = agents.get(agentId);
    if (agent?.isExternal) {
      if (!await confirm(`Kill external process ${agent.name}? (PID ${agent.pid})`)) return;
      sendCommand({ type: "KILL_EXTERNAL", agentId });
    } else {
      if (!await confirm(`Fire ${agent?.name ?? agentId}?`)) return;
      sendCommand({ type: "FIRE_AGENT", agentId });
    }
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
    setMobileTeamOpen(false);
  }, [agents, clearTeamMessages, confirm]);

  const handleRunTask = useCallback(() => {
    if (!selectedAgent || !prompt.trim()) return;
    const agent = agents.get(selectedAgent);
    if (agent?.isExternal) return; // External agents are read-only
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

  // Get the current team phase for the selected agent (if it's a team lead)
  const getAgentPhase = useCallback((agentId: string): string | null => {
    for (const [, tp] of teamPhases) {
      if (tp.leadAgentId === agentId) return tp.phase;
    }
    return null;
  }, [teamPhases]);

  const selectedAgentPhase = selectedAgent ? getAgentPhase(selectedAgent) : null;

  // Note: [PLAN] detection is handled by the gateway, which transitions to "design" phase.
  // The frontend just checks the phase to decide whether to show the Approve button.

  const handleApprovePlan = useCallback(() => {
    if (!selectedAgent) return;
    sendCommand({ type: "APPROVE_PLAN", agentId: selectedAgent });
  }, [selectedAgent]);

  const handleEndProject = useCallback(() => {
    if (!selectedAgent) return;
    sendCommand({ type: "END_PROJECT", agentId: selectedAgent });
    clearTeamMessages();
  }, [selectedAgent, clearTeamMessages]);

  const handleApproval = useCallback((approvalId: string, decision: "yes" | "no") => {
    sendCommand({ type: "APPROVAL_DECISION", approvalId, decision });
  }, []);

  // Zoom controls
  const handleZoomChange = useCallback((newZoom: number) => {
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    forceUpdate((n) => n + 1);
  }, []);

  const agentList = Array.from(agents.values());
  const teamAgents = agentList.filter((a) => !!a.teamId);
  const soloAgents = agentList.filter((a) => !a.teamId && !a.isExternal);
  const externalAgents = agentList.filter((a) => !!a.isExternal);
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
        <PixelOfficeScene
          onAdapterReady={handleAdapterReady}
          onAgentClick={handleAgentClick}
          editMode={editMode}
          editorRef={editorRef}
          officeStateRef={officeStateRef}
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

        {/* Team activity toast notifications */}
        {teamMessages.length > 0 && (
          <TeamActivityToast messages={teamMessages} agents={agents} assetsReady={assetsReady} />
        )}

      </div>

      {/* ── Right Sidebar (desktop only) ── */}
      {!isMobile && (
        <div style={{
          width: "33vw",
          minWidth: 300,
          maxWidth: 420,
          flexShrink: 0,
          height: "100vh",
          backgroundColor: "#1e1a30",
          borderLeft: "2px solid #3d2e54",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Accordion sections */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

          {(() => {
            // Shared agent row renderer
            const renderAgentRow = (agent: typeof agentList[number]) => {
              const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
              const isExpanded = chatOpen && selectedAgent === agent.agentId;
              const agentState = agents.get(agent.agentId);
              const busy = agentState?.status === "working" || agentState?.status === "waiting_approval";
              const isTeamMember = !!agentState?.teamId && !agentState?.isTeamLead;
              const isExternal = !!agentState?.isExternal;

              return (
                <div key={agent.agentId} style={{
                  display: "flex", flexDirection: "column",
                  margin: "3px 6px",
                  border: isExpanded ? "1px solid #e8b04040" : "1px solid #2e2448",
                  backgroundColor: isExpanded ? "#1e1a34" : "#1a1530",
                  transition: "border-color 0.2s, background-color 0.2s",
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
                      <div style={{ fontSize: 10, color: "#7a6858", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}
                        title={isExternal && agentState?.cwd ? agentState.cwd : undefined}
                      >
                        {isExternal && agentState?.cwd ? agentState.cwd.split("/").pop() : agent.role}
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
                        ? "\u2713 Done"
                        : <>{agent.status === "done" ? "\u2713 " : agent.status === "working" ? "\u25B6 " : ""}{cfg.label}</>
                      }
                    </span>
                    {/* Phase badge for team leads */}
                    {agentState?.isTeamLead && (() => {
                      const phase = getAgentPhase(agent.agentId);
                      if (!phase) return null;
                      const PHASE_COLORS: Record<string, string> = { create: "#5aacff", design: "#e8b040", execute: "#e89030", complete: "#48cc6a" };
                      return (
                        <span style={{
                          fontSize: 8, padding: "1px 4px",
                          backgroundColor: (PHASE_COLORS[phase] ?? "#888") + "18",
                          color: PHASE_COLORS[phase] ?? "#888",
                          border: `1px solid ${(PHASE_COLORS[phase] ?? "#888")}40`,
                          flexShrink: 0, whiteSpace: "nowrap", fontFamily: "monospace",
                          textTransform: "uppercase", letterSpacing: "0.05em",
                        }}>{phase}</span>
                      );
                    })()}
                    {!agentState?.teamId && (
                      <span
                        onClick={(e) => { e.stopPropagation(); handleFire(agent.agentId); }}
                        style={{
                          fontSize: 10, color: "#c04040", cursor: "pointer", lineHeight: 1,
                          padding: "4px", flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ff4040"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#c04040"; }}
                      >{"\u2715"}</span>
                    )}
                  </button>

                  {/* Expanded: hybrid panel for external agents (info header + messages) */}
                  {isExpanded && agentState && isExternal && (
                    <div style={{
                      flex: 1,
                      display: "flex", flexDirection: "column",
                      backgroundColor: "#1a1530",
                      minHeight: 0,
                      height: "calc(100vh - 200px)",
                      maxHeight: "calc(100vh - 160px)",
                      overflow: "hidden",
                    }}>
                      {/* Compact info header */}
                      <div style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid #272040",
                        flexShrink: 0,
                      }}>
                        <div style={{ fontSize: 10, color: "#5aacff", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.05em" }}>
                          EXTERNAL PROCESS
                        </div>
                        <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#7a6858", fontFamily: "monospace", flexWrap: "wrap" }}>
                          <span>{agentState.backend ?? "unknown"}</span>
                          <span>PID {agentState.pid ?? "\u2014"}</span>
                          <span title={agentState.cwd ?? undefined} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                            {agentState.cwd ?? "\u2014"}
                          </span>
                        </div>
                      </div>

                      {/* Scrollable messages */}
                      <div style={{
                        flex: 1, overflowY: "auto", padding: "12px 14px",
                        display: "flex", flexDirection: "column",
                        minHeight: 0,
                      }}>
                        {agentState.messages.length === 0 && (
                          <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 12 }}>
                            Waiting for output...
                          </div>
                        )}
                        {agentState.messages.map((msg) => (
                          <MessageBubble key={msg.id} msg={msg} />
                        ))}
                      </div>

                      {/* Read-only footer */}
                      <div style={{
                        padding: "8px 10px",
                        backgroundColor: "#182844", border: "1px solid #3b82f640",
                        fontSize: 11, color: "#7ab8f5", fontFamily: "monospace",
                        textAlign: "center", flexShrink: 0,
                      }}>
                        Read-only — this process is running externally
                      </div>
                    </div>
                  )}
                  {isExpanded && agentState && !isExternal && (
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
                        {/* Phase banner for team leads */}
                        {agentState?.isTeamLead && (() => {
                          const phase = getAgentPhase(agent.agentId);
                          if (!phase) return null;
                          const PHASE_INFO: Record<string, { color: string; icon: string; hint: string }> = {
                            create: { color: "#5aacff", icon: "\uD83D\uDCAC", hint: "Chat with your team lead to define the project" },
                            design: { color: "#e8b040", icon: "\uD83D\uDCCB", hint: "Review the plan \u2014 approve it or give feedback" },
                            execute: { color: "#e89030", icon: "\u26A1", hint: "Team is building your project" },
                            complete: { color: "#48cc6a", icon: "\u2713", hint: "Review results \u2014 give feedback or end project" },
                          };
                          const info = PHASE_INFO[phase];
                          if (!info) return null;
                          return (
                            <div style={{
                              padding: "6px 10px", marginBottom: 8,
                              backgroundColor: info.color + "10",
                              border: `1px solid ${info.color}30`,
                              display: "flex", alignItems: "center", gap: 6,
                              fontSize: 11, fontFamily: "monospace",
                            }}>
                              <span>{info.icon}</span>
                              <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>{phase}</span>
                              <span style={{ color: "#7a6858" }}>{info.hint}</span>
                            </div>
                          );
                        })()}

                        {agentState.messages.length === 0 && (
                          <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 12 }}>
                            {isTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                          </div>
                        )}

                        {agentState.messages.map((msg) => (
                          <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewUrl} isTeamLead={agentState?.isTeamLead} isTeamMember={isTeamMember} teamPhase={agentState?.isTeamLead ? getAgentPhase(agent.agentId) : null} />
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
                              {"\u25B2"} {agentState.pendingApproval.title}
                            </div>
                            <div style={{ fontSize: 12, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                              {agentState.pendingApproval.summary}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                                style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                              >{"\u25B6"} Approve</button>
                              <button
                                onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                                style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 11, fontFamily: "monospace" }}
                              >{"\u2715"} Reject</button>
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>

                      {/* Input / Cancel */}
                      {(() => {
                        const cardPhase = agentState?.isTeamLead ? getAgentPhase(agent.agentId) : null;
                        return (
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
                            ) : cardPhase === "execute" && busy ? (
                              <button
                                onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                                style={{
                                  width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                                  backgroundColor: "#3e1818", color: "#e04848", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                                }}
                              >{"\u2715"} Cancel current work</button>
                            ) : cardPhase === "design" && !busy ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <button
                                  onClick={handleApprovePlan}
                                  style={{
                                    width: "100%", padding: "9px 16px", border: "1px solid #48cc6a",
                                    backgroundColor: "#143a14", color: "#48cc6a", fontSize: 12, cursor: "pointer",
                                    fontWeight: 700, fontFamily: "monospace",
                                  }}
                                >{"\u25B6"} Approve Plan</button>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <input
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                                    placeholder="Or give feedback..."
                                    style={{
                                      flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                                      backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                                    }}
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
                              </div>
                            ) : cardPhase === "complete" && !busy ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <input
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                                    placeholder="Request changes..."
                                    style={{
                                      flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                                      backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                                    }}
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
                                <button
                                  onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                                  style={{
                                    width: "100%", padding: "9px 16px", border: "1px solid #e89030",
                                    backgroundColor: "#261a00", color: "#e89030", fontSize: 12, cursor: "pointer",
                                    fontWeight: 700, fontFamily: "monospace",
                                  }}
                                >End Project</button>
                              </div>
                            ) : isAgentBusy ? (
                              <button
                                onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                                style={{
                                  width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                                  backgroundColor: "#3e1818", color: "#e04848", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                                }}
                              >{"\u2715"} Cancel current work</button>
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
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            };

            return (<>

            {/* -- Tab Bar -- */}
            <div style={{ display: "flex", background: "linear-gradient(to bottom, rgba(40,30,65,0.6), transparent)", padding: "0 4px" }}>
              {([
                { key: "agents" as const, label: "Agents", count: soloAgents.length, color: "#e8b040" },
                { key: "team" as const, label: "Team", count: teamAgents.length, color: "#e89030" },
                { key: "external" as const, label: "External", count: externalAgents.length, color: "#5aacff" },
              ]).map((tab) => {
                const active = expandedSection === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setExpandedSection(tab.key)}
                    style={{
                      flex: 1, padding: "10px 0 8px", cursor: "pointer",
                      backgroundColor: active ? tab.color + "30" : "rgba(255,255,255,0.05)",
                      border: "none",
                      borderBottom: active ? `2px solid ${tab.color}` : "2px solid transparent",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      transition: "all 0.15s",
                      borderRadius: "4px 4px 0 0",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: active ? "#fff" : "#7a6858",
                      fontFamily: "'Press Start 2P', monospace", letterSpacing: "0.04em",
                      textShadow: active ? `0 0 8px ${tab.color}60` : "none",
                    }}>{tab.label}</span>
                    {tab.count > 0 && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px",
                        backgroundColor: active ? tab.color + "20" : "transparent",
                        color: active ? tab.color : "#9a8868",
                        border: `1px solid ${active ? tab.color + "50" : "#3e3458"}`,
                        borderRadius: 3,
                        fontFamily: "monospace", fontWeight: 600,
                      }}>{tab.count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* -- Action Toolbar -- */}
            {expandedSection === "agents" && (
              <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid #2e2448", alignItems: "center" }}>
                <span
                  onClick={() => setShowHireModal(true)}
                  style={{
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                    padding: "5px 10px", borderRadius: 3,
                    backgroundColor: "transparent", color: "#e8b040",
                    border: "1px solid #e8b04060",
                    fontFamily: "monospace",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(200,155,48,0.15)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >+ Hire</span>
              </div>
            )}
            {expandedSection === "team" && (
              <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid #2e2448", alignItems: "center" }}>
                {!hasTeam && (
                  <span
                    onClick={() => setShowHireTeamModal(true)}
                    style={{
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      padding: "5px 10px", borderRadius: 3,
                      backgroundColor: "transparent", color: "#e89030",
                      border: "1px solid #e8903060",
                      fontFamily: "monospace",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(224,133,48,0.15)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >+ Hire Team</span>
                )}
                {hasTeam && teamBusy && (
                  <span
                    onClick={handleStopTeam}
                    style={{
                      fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer",
                      padding: "5px 10px", borderRadius: 3, backgroundColor: "#e89030",
                      fontFamily: "monospace", letterSpacing: "0.03em",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#d07820"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#e89030"; }}
                  >STOP</span>
                )}
                {hasTeam && (
                  <span
                    onClick={handleFireTeam}
                    style={{
                      fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer",
                      padding: "5px 10px", borderRadius: 3, backgroundColor: "#d04040",
                      fontFamily: "monospace", letterSpacing: "0.03em",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#b83030"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#d04040"; }}
                  >{"\u2715"} Fire</span>
                )}
              </div>
            )}

            {/* -- Tab Content -- */}
            {expandedSection === "external" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
                {externalAgents.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 11, fontFamily: "monospace" }}>
                    No external agents detected
                  </div>
                ) : (
                  externalAgents.map((agent) => renderAgentRow(agent))
                )}
              </div>
            )}
            {expandedSection === "agents" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
                {soloAgents.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 11, fontFamily: "monospace" }}>
                    No agents yet {"\u2014"} click [+ Hire] to hire one
                  </div>
                ) : (
                  soloAgents.map((agent) => renderAgentRow(agent))
                )}
              </div>
            )}
            {expandedSection === "team" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
                {teamAgents.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 11, fontFamily: "monospace" }}>
                    No team yet {"\u2014"} click [+ Hire Team] to hire a team
                  </div>
                ) : (
                  <>
                    {teamAgents.map((agent) => renderAgentRow(agent))}
                    {/* Team Activity log */}
                    {teamMessages.length > 0 && (
                      <TeamActivityLog messages={teamMessages} agents={agents} assetsReady={assetsReady} onClear={clearTeamMessages} />
                    )}
                  </>
                )}
              </div>
            )}

            </>);
          })()}

          </div>
        </div>
      )}

      {/* ── Mobile: bottom agent bar ── */}
      {isMobile && agentList.length > 0 && !isChatExpanded && !mobileTeamOpen && (
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
            onClick={() => setMobileTeamOpen(true)}
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
                  {/* TODO: token usage display disabled for now */}
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
              {/* Phase banner for team leads (mobile) */}
              {agentState.isTeamLead && (() => {
                const phase = getAgentPhase(agentState.agentId);
                if (!phase) return null;
                const PHASE_INFO: Record<string, { color: string; icon: string; hint: string }> = {
                  create: { color: "#5aacff", icon: "💬", hint: "Define the project" },
                  design: { color: "#e8b040", icon: "📋", hint: "Review the plan" },
                  execute: { color: "#e89030", icon: "⚡", hint: "Team is building" },
                  complete: { color: "#48cc6a", icon: "✓", hint: "Review results" },
                };
                const info = PHASE_INFO[phase];
                if (!info) return null;
                return (
                  <div style={{
                    padding: "5px 8px", marginBottom: 8,
                    backgroundColor: info.color + "10",
                    border: `1px solid ${info.color}30`,
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 10, fontFamily: "monospace",
                  }}>
                    <span>{info.icon}</span>
                    <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: 8, letterSpacing: "0.05em" }}>{phase}</span>
                    <span style={{ color: "#7a6858" }}>{info.hint}</span>
                  </div>
                );
              })()}

              {agentState.messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 12, fontFamily: "monospace" }}>
                  {mobileIsTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                </div>
              )}

              {agentState.messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewUrl} isTeamLead={agentState.isTeamLead} isTeamMember={mobileIsTeamMember} teamPhase={agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null} />
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
            {(() => {
              const mobilePhase = agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null;
              return (
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
                  ) : mobilePhase === "execute" && busy ? (
                    <button
                      onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                      style={{
                        width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                        backgroundColor: "#3e1818", color: "#e04848", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                      }}
                    >✕ Cancel current work</button>
                  ) : mobilePhase === "design" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={handleApprovePlan}
                        style={{
                          width: "100%", padding: "9px 16px", border: "1px solid #48cc6a",
                          backgroundColor: "#143a14", color: "#48cc6a", fontSize: 12, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >▶ Approve Plan</button>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                          placeholder="Or give feedback..."
                          style={{
                            flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                            backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                          }}
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
                    </div>
                  ) : mobilePhase === "complete" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRunTask()}
                          placeholder="Request changes..."
                          style={{
                            flex: 1, padding: "9px 12px", border: "1px solid #3d2e54",
                            backgroundColor: "#16122a", color: "#eddcb8", fontSize: 13, outline: "none",
                          }}
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
                      <button
                        onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                        style={{
                          width: "100%", padding: "9px 16px", border: "1px solid #e89030",
                          backgroundColor: "#261a00", color: "#e89030", fontSize: 12, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >End Project</button>
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
              );
            })()}
          </div>
        );
      })()}

      {/* Mobile: Team chat fullscreen overlay */}
      {isMobile && mobileTeamOpen && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 30,
          backgroundColor: "#1a1530",
          display: "flex", flexDirection: "column",
        }}>
          <div
            onClick={() => setMobileTeamOpen(false)}
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
        <HireModal
          agentDefs={agentDefs}
          onHire={handleHire}
          onCreate={() => { setShowHireModal(false); setEditingAgent(null); setShowCreateAgent(true); }}
          onEdit={(def) => { setShowHireModal(false); setEditingAgent(def); setShowCreateAgent(true); }}
          onDelete={handleDeleteAgentDef}
          onClose={() => setShowHireModal(false)}
          assetsReady={assetsReady}
        />
      )}

      {showHireTeamModal && (
        <HireTeamModal agentDefs={agentDefs} onCreateTeam={handleCreateTeam} onClose={() => setShowHireTeamModal(false)} assetsReady={assetsReady} />
      )}

      {showCreateAgent && (
        <CreateAgentModal
          onSave={handleSaveAgentDef}
          onClose={() => { setShowCreateAgent(false); setEditingAgent(null); }}
          assetsReady={assetsReady}
          editAgent={editingAgent}
        />
      )}

      {officeStateRef.current && (
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          layout={officeStateRef.current.layout}
          onImportLayout={handleImportLayout}
          onImportTiledMap={handleImportTiledMap}
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
          previewCmd={celebration.previewCmd}
          previewPort={celebration.previewPort}
          projectDir={celebration.projectDir}
          entryFile={celebration.entryFile}
          onPreview={(url) => { setPreviewUrl(url); setCelebration(null); setShowConfetti(false); }}
          onDismiss={() => { setCelebration(null); setShowConfetti(false); }}
        />
      )}
      {confirmModal}
    </div>
  );
}
