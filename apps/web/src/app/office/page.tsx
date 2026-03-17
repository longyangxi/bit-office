"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOfficeStore, folderPickCallbacks, imageUploadCallbacks } from "@/store/office-store";
import type { ChatMessage, TeamChatMessage, TeamPhaseState } from "@/store/office-store";
import { connect, sendCommand } from "@/lib/connection";
import { getConnection } from "@/lib/storage";
import { nanoid } from "nanoid";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentDefinition } from "@office/shared";
import { getCharacterThumbnail } from "@/components/office/sprites/spriteData";
import { OfficeState } from "@/components/office/engine/officeState";
import { EditorState } from "@/components/office/editor/editorState";
import { EditTool } from "@/components/office/types";
import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX } from "@/components/office/constants";
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
const ProjectHistory = dynamic(() => import("@/components/office/ui/ProjectHistory"), { ssr: false });
const OfficeSwitcher = dynamic(() => import("@/components/office/ui/OfficeSwitcher"), { ssr: false });

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  idle: { color: "#7a7060", label: "Idle" },
  working: { color: "#5aacff", label: "Working..." },
  waiting_approval: { color: "#e89030", label: "Needs Approval" },
  done: { color: "#48cc6a", label: "Done" },
  error: { color: "#e04848", label: "Error" },
};

// Check if Enter key is a real submit (not IME confirmation)
// Chrome: isComposing=true during IME; WKWebView (Tauri): keyCode=229 during IME
function isRealEnter(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

// Match URLs and absolute file paths — simple, non-greedy patterns
const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const FILE_RE = /(?:^|\s)(\/[\w./-]+\.\w+)/g;

function linkifyText(children: React.ReactNode): React.ReactNode {
  if (typeof children !== "string") {
    if (Array.isArray(children)) {
      return children.map((child, i) => typeof child === "string" ? linkifyText(child) : child);
    }
    return children;
  }
  const text = children;
  // Find all URLs
  const links: { start: number; end: number; url: string; type: "url" | "file" }[] = [];
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    links.push({ start: m.index, end: m.index + m[0].length, url: m[0], type: "url" });
  }
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text)) !== null) {
    const filePath = m[1];
    const fileStart = m.index + m[0].indexOf(filePath);
    // Don't overlap with existing URL matches
    if (!links.some(l => fileStart >= l.start && fileStart < l.end)) {
      links.push({ start: fileStart, end: fileStart + filePath.length, url: filePath, type: "file" });
    }
  }
  if (links.length === 0) return text;
  links.sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const link of links) {
    if (link.start > lastIdx) parts.push(text.slice(lastIdx, link.start));
    if (link.type === "url") {
      parts.push(<a key={link.start} href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: TERM_TEXT }}>{link.url}</a>);
    } else {
      parts.push(<span key={link.start} onClick={() => sendCommand({ type: "OPEN_FILE", path: link.url })} style={{ color: TERM_TEXT, cursor: "pointer" }} title="Click to open">{link.url}</span>);
    }
    lastIdx = link.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/** Typewriter reveal — adaptive speed: slow for small chunks, faster for large backlogs. */
function TypewriterText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(0);
  const targetRef = useRef(text.length);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    targetRef.current = text.length;
    if (rafRef.current) return; // already animating
    const step = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const dt = time - lastTimeRef.current;
      if (dt >= 25) { // ~40fps cap to avoid too-fast updates
        lastTimeRef.current = time;
        setRevealed((prev) => {
          const remaining = targetRef.current - prev;
          if (remaining <= 0) { rafRef.current = 0; return prev; }
          // Adaptive: 1 char when <20 behind, ramp up for larger backlogs
          const speed = remaining < 20 ? 1 : remaining < 80 ? 2 : Math.ceil(remaining * 0.08);
          return Math.min(prev + speed, targetRef.current);
        });
      }
      if (rafRef.current) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [text]);

  useEffect(() => {
    if (text.length < revealed) { setRevealed(0); lastTimeRef.current = 0; }
  }, [text.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{text.slice(0, revealed)}</>;
}

function ThinkingBubble({ logLine }: { logLine: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{
        padding: "8px 12px",
        backgroundColor: TERM_PANEL, color: "#7a8a6a", fontSize: 12,
        fontFamily: "monospace",
        border: "1px solid #1a2a1a",
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

const RATING_DIMENSIONS = [
  { key: "creativity", label: "Creativity", icon: "✦" },
  { key: "visual", label: "Visual", icon: "◈" },
  { key: "interaction", label: "Interaction", icon: "⚡" },
  { key: "completeness", label: "Completeness", icon: "●" },
  { key: "engagement", label: "Engagement", icon: "♥" },
] as const;

type RatingKey = (typeof RATING_DIMENSIONS)[number]["key"];
type Ratings = Partial<Record<RatingKey, number>>;

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
          >★</span>
        ))}
      </div>
      {value > 0 && (
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{value}/5</span>
      )}
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
        >{submitted ? "Rated ✓" : "★ Rate"}</button>
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
        >✕</button>
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

/** Compute expected preview URL from result metadata (no server started yet) */
function computePreviewUrl(result: { previewUrl?: string; previewCmd?: string; previewPort?: number; previewPath?: string; entryFile?: string }): string | undefined {
  if (result.previewUrl) return result.previewUrl;
  if (result.previewCmd && result.previewPort) return "http://localhost:9101";
  if (result.previewPath) return `http://localhost:9100/${result.previewPath.split("/").pop()}`;
  if (result.entryFile && /\.html?$/i.test(result.entryFile)) return `http://localhost:9100/${result.entryFile.split("/").pop()}`;
  return undefined;
}

/** Whether result has a web-previewable output */
function hasWebPreview(result: { previewUrl?: string; previewCmd?: string; previewPort?: number; previewPath?: string; entryFile?: string }): boolean {
  return !!(result.previewUrl || (result.previewCmd && result.previewPort) || result.previewPath || (result.entryFile && /\.html?$/i.test(result.entryFile)));
}

/** Strip markdown formatting from preview fields */
function cleanPreviewField(v?: string): string | undefined {
  if (!v) return undefined;
  const cleaned = v.replace(/\*\*/g, "").replace(/`/g, "").replace(/^_+|_+$/g, "").trim();
  return cleaned || undefined;
}

/** Build a SERVE_PREVIEW command from result fields */
function buildPreviewCommand(result: { previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string }) {
  const cmd = cleanPreviewField(result.previewCmd);
  const entry = cleanPreviewField(result.entryFile);
  const previewPath = cleanPreviewField(result.previewPath);
  if (cmd && result.previewPort) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: cmd, previewPort: result.previewPort, cwd: result.projectDir };
  }
  if (previewPath) {
    return { type: "SERVE_PREVIEW" as const, filePath: previewPath };
  }
  // HTML entryFile with projectDir — serve the file statically
  if (entry && /\.html?$/i.test(entry) && result.projectDir) {
    return { type: "SERVE_PREVIEW" as const, filePath: result.projectDir + "/" + entry };
  }
  // Desktop/CLI app: PREVIEW_CMD without port, or non-HTML entry file
  if (cmd) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: cmd, cwd: result.projectDir };
  }
  if (entry && !/\.html?$/i.test(entry)) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: entry, cwd: result.projectDir };
  }
  return null;
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
  const resultInfo = { previewUrl, previewCmd, previewPort, previewPath, entryFile };
  const canPreview = hasWebPreview(resultInfo);
  const canLaunch = !canPreview && buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        backgroundColor: "#0e160e", padding: "28px 24px",
        maxWidth: 420, width: "90%", textAlign: "center",
        border: "2px solid #e8b040", boxShadow: "0 0 40px rgba(200,155,48,0.15), 4px 4px 0px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>★</div>
        <div className="px-font" style={{ color: "#e8b040", fontSize: 14, marginBottom: 10, letterSpacing: "0.05em" }}>
          Mission Complete!
        </div>
        <div style={{
          color: "#9a8a68", fontSize: 14, marginBottom: 20, lineHeight: 1.7, fontFamily: "monospace",
        }}>
          Your task has been completed successfully. Ready for the next mission whenever you are.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {canPreview && (
            <button
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                const url = computePreviewUrl(resultInfo);
                if (url) onPreview(url);
              }}
              style={{
                padding: "9px 20px", border: "1px solid #48cc6a",
                backgroundColor: "#143a14", color: "#48cc6a",
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
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
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              }}
            >
              ▶ Launch
            </button>
          )}
          <button
            onClick={onDismiss}
            style={{
              padding: "9px 20px",
              border: "1px solid #1a2a1a", backgroundColor: TERM_PANEL,
              color: "#9a8a68", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
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
        <div style={{ color: "#eee", fontSize: 17, lineHeight: 1.6, marginBottom: 24 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 28px", borderRadius: 8,
              border: "1px solid #444", backgroundColor: "#2a2a3e",
              color: "#aaa", fontSize: 15, cursor: "pointer",
            }}
          >
            No
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 28px", borderRadius: 8, border: "none",
              backgroundColor: "#dc2626", color: "#fff",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
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
      <div style={{ overflowX: "auto", margin: "8px 0", WebkitOverflowScrolling: "touch" }}>
        {children}
      </div>
    );
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
            cursor: "pointer", border: "1px solid #2a2a4a",
            display: "flex", alignItems: "center", gap: 6,
            whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}
          title="Click to open"
        >
          <code {...props}>{text}</code>
        </pre>
      );
    }
    return isBlock ? (
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        <code {...props}>{children}</code>
      </pre>
    ) : (
      <code {...props}>{children}</code>
    );
  },
  table({ children }) {
    return (
      <div style={{ overflowX: "auto", margin: "8px 0", WebkitOverflowScrolling: "touch" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>{children}</a>;
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
      fontSize: 9, padding: "1px 4px",
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
    <ReactMarkdown urlTransform={(url) => url} remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)')}
    </ReactMarkdown>
  );
}

// ── Terminal theme system ──
const TERM_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
const TERM_SIZE = 12;

type TermTheme = {
  name: string;
  accent: string;
  accentRgb: string;
  dim: string;
  text: string;
  textBright: string;
  bg: string;
  panel: string;
  surface: string;
  hover: string;
  border: string;
  borderDim: string;
  codeBg: string;
  codeText: string;
  scrollThumb: string;
  clean?: boolean; // Disable CRT textures, dot grid, glow effects
};

const TERM_THEMES: Record<string, TermTheme> = {
  "green-hacker": {
    name: "Green Hacker",
    accent: "#18ff62",
    accentRgb: "24,255,98",
    dim: "#5a7a5a",
    text: "#9aba9a",
    textBright: "#c8e0c0",
    bg: "#050808",
    panel: "#0c1210",
    surface: "#0a0e0a",
    hover: "#0e1a0e",
    border: "#1a2a1a",
    borderDim: "#152515",
    codeBg: "#060810",
    codeText: "#6a8a6a",
    scrollThumb: "#1a3a1a",
  },
  "tokyo-night": {
    name: "Tokyo Night",
    accent: "#7aa2f7",
    accentRgb: "122,162,247",
    dim: "#6070a0",
    text: "#95a0cc",
    textBright: "#d0d8f8",
    bg: "#1a1b26",
    panel: "#16161e",
    surface: "#1c1e2e",
    hover: "#242840",
    border: "#2d3460",
    borderDim: "#252a4a",
    codeBg: "#151620",
    codeText: "#6670a8",
    scrollThumb: "#2d3460",
  },
  dracula: {
    name: "Dracula",
    accent: "#bd93f9",
    accentRgb: "189,147,249",
    dim: "#7268a0",
    text: "#a898e0",
    textBright: "#f0eaff",
    bg: "#1c1b2e",
    panel: "#22213a",
    surface: "#282840",
    hover: "#302e50",
    border: "#3e3a68",
    borderDim: "#332f58",
    codeBg: "#1a1928",
    codeText: "#7a6eb8",
    scrollThumb: "#3e3a68",
  },
  nord: {
    name: "Nord",
    accent: "#88c0d0",
    accentRgb: "136,192,208",
    dim: "#6888a0",
    text: "#9ac0d4",
    textBright: "#e0f0f8",
    bg: "#1c2028",
    panel: "#222830",
    surface: "#262e38",
    hover: "#2e3a48",
    border: "#344858",
    borderDim: "#2e3e4e",
    codeBg: "#1a2028",
    codeText: "#6a94a8",
    scrollThumb: "#344858",
  },
  monokai: {
    name: "Monokai",
    accent: "#a6e22e",
    accentRgb: "166,226,46",
    dim: "#7a8a48",
    text: "#a8c068",
    textBright: "#e8f0c8",
    bg: "#1a1c14",
    panel: "#22241a",
    surface: "#282a20",
    hover: "#343828",
    border: "#3e4430",
    borderDim: "#343828",
    codeBg: "#181a12",
    codeText: "#7a9040",
    scrollThumb: "#3e4430",
  },
  office: {
    name: "Office",
    accent: "#d4a860",
    accentRgb: "212,168,96",
    dim: "#685848",
    text: "#b8a898",
    textBright: "#e0d4c8",
    bg: "#141218",
    panel: "#1a1820",
    surface: "#201e28",
    hover: "#282430",
    border: "#302a38",
    borderDim: "#262030",
    codeBg: "#18161e",
    codeText: "#a08858",
    scrollThumb: "#383040",
    clean: true,
  },
  slate: {
    name: "Slate",
    accent: "#6aaddf",
    accentRgb: "106,173,223",
    dim: "#606878",
    text: "#b0b8c4",
    textBright: "#d8dce4",
    bg: "#1e2228",
    panel: "#232830",
    surface: "#282e36",
    hover: "#303840",
    border: "#384048",
    borderDim: "#303840",
    codeBg: "#1c2026",
    codeText: "#70a0c8",
    scrollThumb: "#384450",
    clean: true,
  },
};

// Mutable theme variables — reassigned by applyTermTheme()
let TERM_GREEN = "#18ff62";
let TERM_DIM = "#5a7a5a";
let TERM_TEXT = "#9aba9a";
let TERM_TEXT_BRIGHT = "#c8e0c0";
let TERM_ERROR = "#ff6b6b";
let TERM_GLOW = "0 0 8px rgba(24,255,98,0.25)";
let TERM_BG = "#050808";
let TERM_PANEL = "#0c1210";
let TERM_SURFACE = "#0a0e0a";
let TERM_HOVER = "#0e1a0e";
let TERM_BORDER = "#1a2a1a";
let TERM_BORDER_DIM = "#152515";
let TERM_GLOW_BORDER = `0 0 6px ${TERM_GREEN}15, inset 0 0 6px ${TERM_GREEN}08`;
let TERM_GLOW_FOCUS = `0 0 12px ${TERM_GREEN}30, 0 0 4px ${TERM_GREEN}20`;

function applyTermTheme(key: string) {
  const t = TERM_THEMES[key] ?? TERM_THEMES["green-hacker"];
  TERM_GREEN = t.accent;
  TERM_DIM = t.dim;
  TERM_TEXT = t.text;
  TERM_TEXT_BRIGHT = t.textBright;
  TERM_BG = t.bg;
  TERM_PANEL = t.panel;
  TERM_SURFACE = t.surface;
  TERM_HOVER = t.hover;
  TERM_BORDER = t.border;
  TERM_BORDER_DIM = t.borderDim;
  TERM_GLOW = t.clean ? "none" : `0 0 8px rgba(${t.accentRgb},0.25)`;
  TERM_GLOW_BORDER = t.clean ? "none" : `0 0 6px ${t.accent}15, inset 0 0 6px ${t.accent}08`;
  TERM_GLOW_FOCUS = t.clean ? "none" : `0 0 12px ${t.accent}30, 0 0 4px ${t.accent}20`;
  // Update CSS variables for layout.tsx CSS rules
  if (typeof document !== "undefined") {
    const s = document.documentElement.style;
    s.setProperty("--term-bg", t.bg);
    s.setProperty("--term-panel", t.panel);
    s.setProperty("--term-card", t.surface);
    s.setProperty("--term-surface", t.surface);
    s.setProperty("--term-border", t.border);
    s.setProperty("--term-border-dim", t.borderDim);
    s.setProperty("--term-green", t.accent);
    s.setProperty("--term-green-dim", t.dim);
    s.setProperty("--term-text", t.text);
    s.setProperty("--term-text-bright", t.textBright);
    s.setProperty("--term-accent-rgb", t.accentRgb);
    s.setProperty("--term-code-bg", t.codeBg);
    s.setProperty("--term-code-text", t.codeText);
    s.setProperty("--term-scroll-thumb", t.scrollThumb);
    s.setProperty("--term-clean", t.clean ? "1" : "0");
    // Toggle clean mode class on root for CSS selectors
    if (t.clean) {
      document.documentElement.classList.add("term-clean");
    } else {
      document.documentElement.classList.remove("term-clean");
    }
  }
}

const DONE_VERBS = ["Brewed", "Crafted", "Forged", "Compiled", "Shipped", "Deployed", "Hacked", "Rendered", "Built", "Cooked"];
function formatDuration(ms: number): string {
  const verb = DONE_VERBS[Math.floor(ms / 1000) % DONE_VERBS.length];
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${verb} in ${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${verb} for ${min}m ${remSec}s`;
}

function SysMsg({ ts, tag, text, firstLine, isLong, isError }: { ts: string; tag: string; text: string; firstLine: string; isLong: boolean; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textColor = isError ? TERM_ERROR : TERM_DIM;
  return (
    <div className="term-msg" style={{ marginBottom: 2, fontSize: 11, fontFamily: TERM_FONT, fontWeight: 400, lineHeight: 1.5, opacity: isError ? 0.9 : 0.5, padding: "1px 0" }}>
      <span style={{ color: isError ? TERM_ERROR : TERM_DIM, fontSize: 10, marginRight: 6 }}>{ts}</span>
      {isLong && (
        <span
          onClick={() => setExpanded(!expanded)}
          style={{ color: isError ? TERM_ERROR : TERM_GREEN, opacity: 0.4, cursor: "pointer", marginRight: 4 }}
        >{expanded ? "\u25BE" : "\u25B8"}</span>
      )}
      <span style={{ color: isError ? TERM_ERROR : TERM_GREEN, opacity: 0.5, fontSize: 10, marginRight: 6 }}>{tag}</span>
      <span style={{ color: textColor, wordBreak: "break-word" }} className="chat-markdown">
        {isLong && !expanded
          ? <span>{firstLine}</span>
          : <MdContent text={text} />
        }
      </span>
    </div>
  );
}

function MessageBubble({ msg, agentName, onPreview, isTeamLead, isTeamMember, teamPhase }: { msg: ChatMessage; agentName?: string; onPreview?: (url: string) => void; isTeamLead?: boolean; isTeamMember?: boolean; teamPhase?: string | null }) {
  const ts = new Date(msg.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base: React.CSSProperties = { marginBottom: 4, fontSize: TERM_SIZE, fontFamily: TERM_FONT, fontWeight: 400, lineHeight: 1.6 };

  // ── User input ──
  if (msg.role === "user") {
    const isFromTeam = msg.text.startsWith("[From ");
    if (isFromTeam && msg.text.length > 80) {
      return <SysMsg ts={ts} tag="task" text={msg.text} firstLine={msg.text.slice(0, 80) + "..."} isLong={true} />;
    }
    return (
      <div className="term-msg" style={{
        ...base, marginTop: 14, marginBottom: 8,
        borderLeft: `2px solid ${TERM_GREEN}50`,
        backgroundColor: `${TERM_GREEN}06`,
        padding: "6px 12px",
        borderRadius: "0 4px 4px 0",
      }}>
        <span style={{ color: TERM_DIM, fontSize: 10, marginRight: 6 }}>{ts}</span>
        <span style={{ color: TERM_GREEN, textShadow: TERM_GLOW }}>&gt; </span>
        <span style={{ color: TERM_TEXT_BRIGHT, wordBreak: "break-word" }}>{linkifyText(msg.text)}</span>
      </div>
    );
  }

  // ── System ──
  if (msg.role === "system") {
    const isDelegation = msg.text.startsWith("Delegated to ");
    const isResult = msg.text.startsWith("Result from ");
    const isQueued = msg.text.startsWith("Task queued ");
    const isError = /^(ERROR|error|Error)[:\s]|not found\b|failed\b|limit\b|denied\b/i.test(msg.text) && !isDelegation && !isResult && !isQueued;
    const tag = isDelegation ? "delegate" : isResult ? "result" : isQueued ? "queued" : isError ? "error" : "sys";
    const isLong = msg.text.length > 80;
    const firstLine = isLong ? msg.text.slice(0, 80) + "..." : msg.text;
    return <SysMsg ts={ts} tag={tag} text={msg.text} firstLine={firstLine} isLong={isLong} isError={isError} />;
  }

  // ── Agent ──
  const isStreaming = msg.id.endsWith("-stream");
  const hasFullOutput = !!(msg.result?.fullOutput && msg.result.fullOutput !== msg.text && msg.result.fullOutput.length > msg.text.length + 20);
  const planMatch = msg.text.match(/\[PLAN\]([\s\S]*?)\[\/PLAN\]/i);
  const planContent = planMatch?.[1]?.trim();
  const textWithoutPlan = planContent ? msg.text.replace(/\[PLAN\][\s\S]*?\[\/PLAN\]/i, "").trim() : null;
  const displayText = hasFullOutput ? (msg.result?.fullOutput ?? msg.text) : msg.text;

  // Streaming message — raw typewriter output
  if (isStreaming) {
    if (!msg.text) {
      return (
        <div style={{ ...base, padding: "2px 0" }}>
          <span style={{ color: TERM_DIM, fontSize: 10, marginRight: 6 }}>{ts}</span>
          <span style={{ color: TERM_GREEN, opacity: 0.4, fontSize: 10 }}>{agentName ?? "agent"}</span>
          <span style={{ color: TERM_GREEN, opacity: 0.5, marginLeft: 8 }} className="working-dots"><span className="working-dots-mid" /></span>
        </div>
      );
    }
    return (
      <div style={{ ...base, padding: "2px 0" }}>
        <span style={{ color: TERM_DIM, fontSize: 10, marginRight: 6 }}>{ts}</span>
        <span style={{ color: TERM_GREEN, opacity: 0.4, fontSize: 10 }}>{agentName ?? "agent"}</span>
        <div style={{ marginTop: 2, color: TERM_TEXT, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
          <TypewriterText text={msg.text} />
        </div>
      </div>
    );
  }

  // Completion
  if (isTeamLead && msg.isFinalResult && msg.result) {
    const r = msg.result;
    const cleanSummary = r.summary.replace(/ENTRY_FILE:\s*.+/gi, "").replace(/PROJECT_DIR:\s*.+/gi, "").replace(/SUMMARY:\s*/gi, "").trim();
    const entryFile = r.entryFile ?? r.summary.match(/ENTRY_FILE:\s*(.+)/i)?.[1]?.trim();
    const projectDir = r.projectDir ?? r.summary.match(/PROJECT_DIR:\s*(.+)/i)?.[1]?.trim();
    const changedFiles = r.changedFiles ?? [];
    const btnStyle: React.CSSProperties = { color: TERM_GREEN, cursor: "pointer", border: `1px solid ${TERM_GREEN}40`, padding: "4px 16px", borderRadius: 3, fontSize: 11, fontFamily: TERM_FONT, fontWeight: 600, backgroundColor: `${TERM_GREEN}08`, transition: "all 0.15s", boxShadow: "none" };
    const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}18`; e.currentTarget.style.boxShadow = `0 0 8px ${TERM_GREEN}15`; };
    const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}08`; e.currentTarget.style.boxShadow = "none"; };
    return (
      <div className="term-msg" style={{ ...base, marginTop: 12, borderTop: `1px solid ${TERM_GREEN}10`, paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: TERM_DIM, fontSize: 10 }}>{ts}</span>
          <span style={{
            display: "inline-block", padding: "2px 10px", borderRadius: 3,
            backgroundColor: `${TERM_GREEN}15`, color: TERM_GREEN,
            fontSize: 10, fontFamily: TERM_FONT, fontWeight: 600, letterSpacing: "0.04em",
          }}>DONE</span>
          {msg.durationMs && msg.durationMs > 1000 && (
            <span style={{ color: TERM_DIM, fontSize: 10, fontFamily: TERM_FONT }}>{formatDuration(msg.durationMs)}</span>
          )}
        </div>
        <div style={{ color: TERM_TEXT, wordBreak: "break-word", lineHeight: 1.6 }} className="chat-markdown"><MdContent text={cleanSummary || "completed."} /></div>
        {(projectDir || entryFile) && (
          <div style={{ color: TERM_DIM, fontSize: 11, marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
            {projectDir && <span className="term-path-scroll" style={{ opacity: 0.6 }}>{projectDir}</span>}
            {entryFile && <span onClick={() => sendCommand({ type: "OPEN_FILE", path: entryFile })} style={{ cursor: "pointer", color: TERM_GREEN, opacity: 0.6 }}>{entryFile}</span>}
          </div>
        )}
        {changedFiles.length > 0 && <div style={{ color: TERM_DIM, fontSize: 11, marginTop: 2 }}>{changedFiles.length} files changed</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {hasWebPreview(r) && onPreview && <button className="term-btn" onClick={() => { const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); const url = computePreviewUrl(r); if (url) onPreview(url); }} style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}>preview</button>}
          {!hasWebPreview(r) && buildPreviewCommand(r) && <button className="term-btn" onClick={() => { const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); }} style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}>launch</button>}
        </div>
      </div>
    );
  }

  // ── Regular agent message ──
  const btnStyle: React.CSSProperties = { color: TERM_GREEN, cursor: "pointer", border: `1px solid ${TERM_GREEN}40`, padding: "4px 16px", borderRadius: 3, fontSize: 11, fontFamily: TERM_FONT, fontWeight: 600, backgroundColor: `${TERM_GREEN}08`, transition: "all 0.15s", boxShadow: "none", marginTop: 8, display: "inline-block" };
  const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}18`; e.currentTarget.style.boxShadow = `0 0 8px ${TERM_GREEN}15`; };
  const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}08`; e.currentTarget.style.boxShadow = "none"; };

  return (
    <div className="term-msg" style={{ ...base, paddingTop: 8, marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ color: TERM_DIM, fontSize: 10 }}>{ts}</span>
        <span style={{ color: TERM_GREEN, opacity: 0.5, fontSize: 10 }}>{agentName ?? "agent"}</span>
      </div>
      <div style={{ color: TERM_TEXT, wordBreak: "break-word", lineHeight: 1.6 }} className="chat-markdown">
        {planContent ? (
          <>
            {textWithoutPlan && <div className="chat-markdown"><MdContent text={textWithoutPlan} /></div>}
            <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${TERM_GREEN}18` }}>
              <div style={{ color: TERM_GREEN, opacity: 0.4, fontSize: 10, marginBottom: 4, letterSpacing: "0.04em" }}>PLAN</div>
              <div className="chat-markdown"><MdContent text={planContent!} /></div>
            </div>
          </>
        ) : (
          <MdContent text={displayText} />
        )}
        {msg.result && msg.result.changedFiles.length > 0 && !planContent && (
          <div style={{ color: TERM_DIM, fontSize: 11, marginTop: 4 }}>{msg.result.changedFiles.length} files: {msg.result.changedFiles.slice(0, 3).join(", ")}{msg.result.changedFiles.length > 3 ? ` +${msg.result.changedFiles.length - 3}` : ""}</div>
        )}
        {msg.result && hasWebPreview(msg.result) && onPreview && !isTeamMember && !isTeamLead && (
          <button className="term-btn" onClick={() => { const r = msg.result!; const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); const url = computePreviewUrl(r); if (url) setTimeout(() => onPreview(url), r.previewUrl ? 0 : 1500); }} style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}>preview</button>
        )}
        {msg.durationMs && msg.durationMs > 1000 && (
          <div style={{ color: TERM_DIM, marginTop: 4, fontSize: 10, fontFamily: TERM_FONT }}>
            {formatDuration(msg.durationMs)}
          </div>
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



/** Loading overlay with a random pixel character walking back and forth */
function LoadingOverlay({ visible }: { visible: boolean }) {
  const [charIdx, setCharIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [removed, setRemoved] = useState(false);

  // Pick random character only on client to avoid hydration mismatch
  useEffect(() => {
    setCharIdx(Math.floor(Math.random() * 6));
    setMounted(true);
  }, []);

  // When visible goes true again (e.g. office switch), reset fade state & pick new char
  useEffect(() => {
    if (visible) {
      setCharIdx(Math.floor(Math.random() * 6));
      setOpacity(1);
      setRemoved(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible && mounted) {
      // Fade out over 600ms
      const t1 = setTimeout(() => setOpacity(0), 50);
      const t2 = setTimeout(() => setRemoved(true), 700);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [visible, mounted]);

  if (removed || !mounted) return null;

  const sheetUrl = `/assets/characters/char_${charIdx}.png`;
  const zoom = 4;
  const displayW = 16 * zoom; // 64
  const displayH = 32 * zoom; // 128

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      zIndex: 50,
      background: "#0e0c1a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      opacity,
      transition: "opacity 0.6s ease",
      pointerEvents: visible ? "auto" : "none",
    }}>
      <style>{`
        @keyframes loading-walk-sprite {
          0%   { background-position-x: 0px; }
          25%  { background-position-x: -64px; }
          50%  { background-position-x: -128px; }
          75%  { background-position-x: -64px; }
          100% { background-position-x: 0px; }
        }
        @keyframes loading-walk-move {
          0%   { transform: translateX(-60px) scaleX(1); }
          45%  { transform: translateX(60px) scaleX(1); }
          50%  { transform: translateX(60px) scaleX(-1); }
          95%  { transform: translateX(-60px) scaleX(-1); }
          100% { transform: translateX(-60px) scaleX(1); }
        }
      `}</style>
      <div style={{ position: "relative", width: displayW, height: displayH }}>
        <div style={{
          width: displayW,
          height: displayH,
          backgroundImage: `url(${sheetUrl})`,
          backgroundSize: "448px 384px",
          backgroundPositionY: "-256px",
          imageRendering: "pixelated" as const,
          animation: "loading-walk-sprite 0.5s steps(1) infinite, loading-walk-move 3s linear infinite",
        }} />
      </div>
      <div style={{
        fontFamily: "monospace",
        fontSize: 13,
        color: "#7a6858",
        letterSpacing: "0.05em",
      }}>
        Loading office<span style={{ display: "inline-block", width: "1.5em", textAlign: "left" }}>
          <LoadingDots />
        </span>
      </div>
    </div>
  );
}

function LoadingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const timer = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 400);
    return () => clearInterval(timer);
  }, []);
  return <>{dots}</>;
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

/** Agency-agents catalog: category > subcategory > agents */
type AgencyCatalogAgent = { name: string; desc: string };
type AgencyCatalogSubcategory = { name: string; label: string; agents: AgencyCatalogAgent[] };
type AgencyCatalogCategory = { category: string; label: string; subcategories: AgencyCatalogSubcategory[] };

const AGENCY_CATALOG: AgencyCatalogCategory[] = [
  { category: "academic", label: "Academic", subcategories: [
    { name: "_root", label: "Academic", agents: [
      { name: "Anthropologist", desc: "Expert in cultural systems, rituals, kinship, belief systems, and ethnographic method" },
      { name: "Geographer", desc: "Expert in physical and human geography, climate systems, cartography, and spatial analysis" },
      { name: "Historian", desc: "Expert in historical analysis, periodization, material culture, and historiography" },
      { name: "Narratologist", desc: "Expert in narrative theory, story structure, character arcs, and literary analysis" },
      { name: "Psychologist", desc: "Expert in human behavior, personality theory, motivation, and cognitive patterns" },
    ]},
  ]},
  { category: "design", label: "Design", subcategories: [
    { name: "_root", label: "Design", agents: [
      { name: "Brand Guardian", desc: "Expert brand strategist specializing in brand identity development, consistency" },
      { name: "Image Prompt Engineer", desc: "Expert photography prompt engineer for crafting detailed AI image generation prompts" },
      { name: "Inclusive Visuals Specialist", desc: "Representation expert defeating systemic AI biases for culturally accurate visuals" },
      { name: "UI Designer", desc: "Expert UI designer specializing in visual design systems, component libraries" },
      { name: "UX Architect", desc: "Technical architecture and UX specialist providing developers with solid foundations" },
      { name: "UX Researcher", desc: "Expert user experience researcher in user behavior analysis, usability testing" },
      { name: "Visual Storyteller", desc: "Expert visual communication specialist creating compelling visual narratives" },
      { name: "Whimsy Injector", desc: "Expert creative specialist adding personality, delight, and playful elements to brands" },
    ]},
  ]},
  { category: "engineering", label: "Engineering", subcategories: [
    { name: "_root", label: "Engineering", agents: [
      { name: "AI Data Remediation Engineer", desc: "Specialist in self-healing data pipelines using air-gapped local SLMs and semantic clustering" },
      { name: "AI Engineer", desc: "Expert AI/ML engineer in machine learning model development, deployment, integration" },
      { name: "Autonomous Optimization Architect", desc: "Intelligent system governor that shadow-tests APIs for performance optimization" },
      { name: "Backend Architect", desc: "Senior backend architect in scalable system design, database architecture, APIs" },
      { name: "Code Reviewer", desc: "Expert code reviewer providing constructive feedback on correctness, maintainability" },
      { name: "Data Engineer", desc: "Expert data engineer building reliable data pipelines, lakehouse architectures" },
      { name: "Database Optimizer", desc: "Expert database specialist in schema design, query optimization, indexing strategies" },
      { name: "DevOps Automator", desc: "Expert DevOps engineer in infrastructure automation, CI/CD pipeline development" },
      { name: "Embedded Firmware Engineer", desc: "Specialist in bare-metal and RTOS firmware - ESP32/ESP-IDF, PlatformIO, Arduino, ARM" },
      { name: "Feishu Integration Developer", desc: "Full-stack integration expert for the Feishu (Lark) Open Platform" },
      { name: "Frontend Developer", desc: "Expert frontend developer in modern web technologies, React/Vue/Angular frameworks" },
      { name: "Git Workflow Master", desc: "Expert in Git workflows, branching strategies, and version control best practices" },
      { name: "Incident Response Commander", desc: "Expert incident commander in production incident management, structured response" },
      { name: "Mobile App Builder", desc: "Specialized mobile app developer with native iOS/Android and cross-platform expertise" },
      { name: "Rapid Prototyper", desc: "Specialized in ultra-fast proof-of-concept development and MVP creation" },
      { name: "Security Engineer", desc: "Expert application security engineer in threat modeling, vulnerability assessment" },
      { name: "Senior Developer", desc: "Premium implementation specialist - Laravel/Livewire/FluxUI, advanced CSS, Three.js" },
      { name: "Software Architect", desc: "Expert software architect in system design, domain-driven design, architectural patterns" },
      { name: "Solidity Smart Contract Engineer", desc: "Expert Solidity developer in EVM smart contract architecture, gas optimization" },
      { name: "SRE (Site Reliability Engineer)", desc: "Expert site reliability engineer in SLOs, error budgets, observability, chaos engineering" },
      { name: "Technical Writer", desc: "Expert technical writer in developer documentation, API references, README files" },
      { name: "Threat Detection Engineer", desc: "Expert detection engineer in SIEM rule development, MITRE ATT&CK coverage mapping" },
      { name: "WeChat Mini Program Developer", desc: "Expert WeChat Mini Program developer in WXML/WXSS/WXS, WeChat API integration" },
    ]},
  ]},
  { category: "game-development", label: "Game Dev", subcategories: [
    { name: "_root", label: "Cross-Engine", agents: [
      { name: "Game Audio Engineer", desc: "Interactive audio specialist - FMOD/Wwise integration, adaptive music, spatial audio" },
      { name: "Game Designer", desc: "Systems and mechanics architect - GDD authorship, player psychology, economy balancing" },
      { name: "Level Designer", desc: "Spatial storytelling and flow specialist - layout theory, pacing, encounter design" },
      { name: "Narrative Designer", desc: "Story systems and dialogue architect - branching dialogue, lore, environmental storytelling" },
      { name: "Technical Artist", desc: "Art-to-engine pipeline specialist - shaders, VFX systems, LOD pipelines, performance" },
    ]},
    { name: "blender", label: "Blender", agents: [
      { name: "Blender Add-on Engineer", desc: "Blender tooling specialist - Python add-ons, asset validators, exporters, pipeline automation" },
    ]},
    { name: "godot", label: "Godot", agents: [
      { name: "Godot Gameplay Scripter", desc: "Composition and signal integrity specialist - GDScript 2.0, C# integration, node-based arch" },
      { name: "Godot Multiplayer Engineer", desc: "Godot 4 networking specialist - MultiplayerAPI, scene replication, ENet/WebRTC transport" },
      { name: "Godot Shader Developer", desc: "Godot 4 visual effects specialist - Godot Shading Language (GLSL-like), VisualShader editor" },
    ]},
    { name: "roblox-studio", label: "Roblox Studio", agents: [
      { name: "Roblox Avatar Creator", desc: "Roblox UGC and avatar pipeline specialist - avatar system, UGC item creation, accessories" },
      { name: "Roblox Experience Designer", desc: "Roblox platform UX and monetization specialist - engagement loops, DataStore-driven progress" },
      { name: "Roblox Systems Scripter", desc: "Roblox platform engineering specialist - Luau, client-server security, RemoteEvents" },
    ]},
    { name: "unity", label: "Unity", agents: [
      { name: "Unity Architect", desc: "Data-driven modularity specialist - ScriptableObjects, decoupled systems, clean architecture" },
      { name: "Unity Editor Tool Developer", desc: "Unity editor automation specialist - custom EditorWindows, PropertyDrawers, AssetPostprocess" },
      { name: "Unity Multiplayer Engineer", desc: "Networked gameplay specialist - Netcode for GameObjects, Unity Gaming Services (Relay/Lobby)" },
      { name: "Unity Shader Graph Artist", desc: "Visual effects and material specialist - Unity Shader Graph, HLSL, URP/HDRP rendering" },
    ]},
    { name: "unreal-engine", label: "Unreal Engine", agents: [
      { name: "Unreal Multiplayer Architect", desc: "Unreal Engine networking specialist - Actor replication, GameMode/GameState architecture" },
      { name: "Unreal Systems Engineer", desc: "Performance and hybrid architecture specialist - C++/Blueprint continuum, Nanite, Lumen" },
      { name: "Unreal Technical Artist", desc: "Unreal Engine visual pipeline specialist - Material Editor, Niagara VFX, Procedural Content" },
      { name: "Unreal World Builder", desc: "Open-world and environment specialist - UE5 World Partition, Landscape, procedural foliage" },
    ]},
  ]},
  { category: "marketing", label: "Marketing", subcategories: [
    { name: "_root", label: "Marketing", agents: [
      { name: "AI Citation Strategist", desc: "Expert in AI recommendation engine optimization (AEO/GEO) — audits brand visibility" },
      { name: "App Store Optimizer", desc: "Expert app store marketing specialist focused on ASO, conversion rate optimization" },
      { name: "Baidu SEO Specialist", desc: "Expert Baidu search optimization specialist for Chinese search engine ranking" },
      { name: "Bilibili Content Strategist", desc: "Expert Bilibili marketing specialist focused on UP主 growth, danmaku culture mastery" },
      { name: "Book Co-Author", desc: "Strategic thought-leadership book collaborator for founders, experts, and operators" },
      { name: "Carousel Growth Engine", desc: "Autonomous TikTok and Instagram carousel generation specialist via URL analysis" },
      { name: "China E-Commerce Operator", desc: "Expert China e-commerce specialist covering Taobao, Tmall, Pinduoduo, JD ecosystems" },
      { name: "Content Creator", desc: "Expert content strategist and creator for multi-platform campaigns, editorial calendars" },
      { name: "Cross-Border E-Commerce Specialist", desc: "Full-funnel cross-border e-commerce strategist covering Amazon, Shopee, Lazada, AliExpress" },
      { name: "Douyin Strategist", desc: "Short-video marketing expert specializing in the Douyin platform, recommendation algo" },
      { name: "Growth Hacker", desc: "Expert growth strategist in rapid user acquisition through data-driven experimentation" },
      { name: "Instagram Curator", desc: "Expert Instagram marketing specialist in visual storytelling, community building" },
      { name: "Kuaishou Strategist", desc: "Expert Kuaishou marketing strategist for short-video content in China's lower-tier cities" },
      { name: "LinkedIn Content Creator", desc: "Expert LinkedIn content strategist focused on thought leadership, personal brand building" },
      { name: "Livestream Commerce Coach", desc: "Veteran livestream e-commerce coach specializing in host training, live room operations" },
      { name: "Podcast Strategist", desc: "Content strategy and operations expert for the Chinese podcast market" },
      { name: "Private Domain Operator", desc: "Expert in building enterprise WeChat (WeCom) private domain ecosystems, SCRM" },
      { name: "Reddit Community Builder", desc: "Expert Reddit marketing specialist in authentic community engagement, value-driven content" },
      { name: "SEO Specialist", desc: "Expert search engine optimization strategist in technical SEO, content optimization" },
      { name: "Short-Video Editing Coach", desc: "Hands-on short-video editing coach covering full post-production pipeline, CapCut mastery" },
      { name: "Social Media Strategist", desc: "Expert social media strategist for LinkedIn, Twitter, and professional platforms" },
      { name: "TikTok Strategist", desc: "Expert TikTok marketing specialist in viral content creation, algorithm optimization" },
      { name: "Twitter Engager", desc: "Expert Twitter marketing specialist in real-time engagement, thought leadership" },
      { name: "WeChat Official Account Manager", desc: "Expert WeChat Official Account strategist in content marketing, subscriber engagement" },
      { name: "Weibo Strategist", desc: "Full-spectrum operations expert for Sina Weibo, trending topic mechanics, SuperFans" },
      { name: "Xiaohongshu Specialist", desc: "Expert Xiaohongshu marketing specialist in lifestyle content, trend-driven strategies" },
      { name: "Zhihu Strategist", desc: "Expert Zhihu marketing specialist in thought leadership, community credibility" },
    ]},
  ]},
  { category: "paid-media", label: "Paid Media", subcategories: [
    { name: "_root", label: "Paid Media", agents: [
      { name: "Paid Media Auditor", desc: "Comprehensive paid media auditor evaluating Google Ads, Microsoft Ads, Meta accounts" },
      { name: "Ad Creative Strategist", desc: "Paid media creative specialist in ad copywriting, RSA optimization, asset group design" },
      { name: "Paid Social Strategist", desc: "Cross-platform paid social advertising specialist covering Meta, LinkedIn, TikTok" },
      { name: "PPC Campaign Strategist", desc: "Senior paid media strategist in large-scale search, shopping, and performance max campaigns" },
      { name: "Programmatic & Display Buyer", desc: "Display advertising and programmatic media buying specialist covering managed placements" },
      { name: "Search Query Analyst", desc: "Specialist in search term analysis, negative keyword architecture, query-to-intent mapping" },
      { name: "Tracking & Measurement Specialist", desc: "Expert in conversion tracking architecture, tag management, attribution modeling" },
    ]},
  ]},
  { category: "product", label: "Product", subcategories: [
    { name: "_root", label: "Product", agents: [
      { name: "Behavioral Nudge Engine", desc: "Behavioral psychology specialist adapting software interaction cadences for user engagement" },
      { name: "Feedback Synthesizer", desc: "Expert in collecting, analyzing, and synthesizing user feedback from multiple channels" },
      { name: "Product Manager", desc: "Holistic product leader owning full product lifecycle — discovery through go-to-market" },
      { name: "Sprint Prioritizer", desc: "Expert product manager in agile sprint planning, feature prioritization, resource allocation" },
      { name: "Trend Researcher", desc: "Expert market intelligence analyst in emerging trends, competitive analysis" },
    ]},
  ]},
  { category: "project-management", label: "Project Mgmt", subcategories: [
    { name: "_root", label: "Project Mgmt", agents: [
      { name: "Experiment Tracker", desc: "Expert project manager in experiment design, execution tracking, data-driven decisions" },
      { name: "Jira Workflow Steward", desc: "Expert delivery operations specialist enforcing Jira-linked Git workflows, traceable commits" },
      { name: "Project Shepherd", desc: "Expert project manager in cross-functional project coordination, timeline management" },
      { name: "Studio Operations", desc: "Expert operations manager in day-to-day studio efficiency, process optimization" },
      { name: "Studio Producer", desc: "Senior strategic leader in high-level creative and technical project orchestration" },
      { name: "Senior Project Manager", desc: "Converts specs to tasks, remembers previous projects. Focused on realistic scope" },
    ]},
  ]},
  { category: "sales", label: "Sales", subcategories: [
    { name: "_root", label: "Sales", agents: [
      { name: "Account Strategist", desc: "Expert post-sale account strategist in land-and-expand execution, stakeholder mapping" },
      { name: "Sales Coach", desc: "Expert sales coaching specialist in rep development, pipeline review, call coaching" },
      { name: "Deal Strategist", desc: "Senior deal strategist in MEDDPICC qualification, competitive positioning, win planning" },
      { name: "Discovery Coach", desc: "Coaches sales teams on elite discovery methodology — question design, gap quantification" },
      { name: "Sales Engineer", desc: "Senior pre-sales engineer in technical discovery, demo engineering, POC scoping" },
      { name: "Outbound Strategist", desc: "Signal-based outbound specialist designing multi-channel prospecting sequences, ICP" },
      { name: "Pipeline Analyst", desc: "Revenue operations analyst in pipeline health diagnostics, deal velocity analysis" },
      { name: "Proposal Strategist", desc: "Strategic proposal architect transforming RFPs into compelling win narratives" },
    ]},
  ]},
  { category: "spatial-computing", label: "Spatial Computing", subcategories: [
    { name: "_root", label: "Spatial Computing", agents: [
      { name: "macOS Spatial/Metal Engineer", desc: "Native Swift and Metal specialist building high-performance 3D rendering systems" },
      { name: "Terminal Integration Specialist", desc: "Terminal emulation, text rendering optimization, SwiftTerm integration for modern Swift" },
      { name: "visionOS Spatial Engineer", desc: "Native visionOS spatial computing, SwiftUI volumetric interfaces, Liquid Glass design" },
      { name: "XR Cockpit Interaction Specialist", desc: "Specialist in designing immersive cockpit-based control systems for XR environments" },
      { name: "XR Immersive Developer", desc: "Expert WebXR and immersive technology developer in browser-based AR/VR/XR applications" },
      { name: "XR Interface Architect", desc: "Spatial interaction designer and interface strategist for immersive AR/VR/XR environments" },
    ]},
  ]},
  { category: "specialized", label: "Specialized", subcategories: [
    { name: "_root", label: "Specialized", agents: [
      { name: "Accounts Payable Agent", desc: "Autonomous payment processing specialist executing vendor payments, contractor invoices" },
      { name: "Agentic Identity & Trust Architect", desc: "Designs identity, authentication, and trust verification systems for autonomous AI agents" },
      { name: "Agents Orchestrator", desc: "Autonomous pipeline manager orchestrating the entire development workflow" },
      { name: "Automation Governance Architect", desc: "Governance-first architect for business automations (n8n-first) auditing value and risk" },
      { name: "Blockchain Security Auditor", desc: "Expert smart contract security auditor in vulnerability detection, formal verification" },
      { name: "Compliance Auditor", desc: "Expert technical compliance auditor in SOC 2, ISO 27001, HIPAA, PCI-DSS audits" },
      { name: "Corporate Training Designer", desc: "Expert in enterprise training system design and curriculum development" },
      { name: "Cultural Intelligence Strategist", desc: "CQ specialist detecting invisible exclusion, researching global context for inclusive software" },
      { name: "Data Consolidation Agent", desc: "AI agent consolidating extracted sales data into live reporting dashboards" },
      { name: "Developer Advocate", desc: "Expert developer advocate building developer communities, creating technical content" },
      { name: "Document Generator", desc: "Expert document creation specialist generating professional PDF, PPTX, DOCX, XLSX files" },
      { name: "French Consulting Market Navigator", desc: "Navigate the French ESN/SI freelance ecosystem — margin models, platform mechanics" },
      { name: "Government Digital Presales Consultant", desc: "Presales expert for China's government digital transformation market (ToG)" },
      { name: "Healthcare Marketing Compliance Specialist", desc: "Expert in healthcare marketing compliance in China, Advertising Law, Medical Advertising" },
      { name: "Identity Graph Operator", desc: "Operates a shared identity graph that multiple AI agents resolve against" },
      { name: "Korean Business Navigator", desc: "Korean business culture for foreign professionals — decision process, nunchi reading" },
      { name: "LSP/Index Engineer", desc: "Language Server Protocol specialist building unified code intelligence systems" },
      { name: "MCP Builder", desc: "Expert Model Context Protocol developer who designs, builds, and tests MCP servers" },
      { name: "Model QA Specialist", desc: "Independent model QA expert auditing ML and statistical models end-to-end" },
      { name: "Recruitment Specialist", desc: "Expert recruitment operations and talent acquisition specialist" },
      { name: "Report Distribution Agent", desc: "AI agent automating distribution of consolidated sales reports to representatives" },
      { name: "Sales Data Extraction Agent", desc: "AI agent specialized in monitoring Excel files and extracting key sales metrics" },
      { name: "Salesforce Architect", desc: "Solution architecture for Salesforce platform — multi-cloud design, integration patterns" },
      { name: "Study Abroad Advisor", desc: "Full-spectrum study abroad planning expert covering US, UK, Canada, Australia, Europe" },
      { name: "Supply Chain Strategist", desc: "Expert supply chain management and procurement strategy specialist" },
      { name: "Workflow Architect", desc: "Workflow design specialist mapping complete workflow trees for every system and journey" },
      { name: "ZK Steward", desc: "Knowledge-base steward in the spirit of Niklas Luhmann's Zettelkasten" },
    ]},
  ]},
  { category: "support", label: "Support & Ops", subcategories: [
    { name: "_root", label: "Support & Ops", agents: [
      { name: "Analytics Reporter", desc: "Expert data analyst transforming raw data into actionable business insights, dashboards" },
      { name: "Executive Summary Generator", desc: "Consultant-grade AI specialist communicating like a senior strategy consultant" },
      { name: "Finance Tracker", desc: "Expert financial analyst in financial planning, budget management, cash flow optimization" },
      { name: "Infrastructure Maintainer", desc: "Expert infrastructure specialist in system reliability, performance optimization" },
      { name: "Legal Compliance Checker", desc: "Expert legal and compliance specialist ensuring business operations meet regulations" },
      { name: "Support Responder", desc: "Expert customer support specialist delivering exceptional service, issue resolution" },
    ]},
  ]},
  { category: "testing", label: "Testing & QA", subcategories: [
    { name: "_root", label: "Testing & QA", agents: [
      { name: "Accessibility Auditor", desc: "Expert accessibility specialist auditing interfaces against WCAG standards" },
      { name: "API Tester", desc: "Expert API testing specialist in comprehensive API validation, performance testing" },
      { name: "Evidence Collector", desc: "Screenshot-obsessed, fantasy-allergic QA specialist - finds 3-5 issues, requires visual proof" },
      { name: "Performance Benchmarker", desc: "Expert performance testing specialist in measuring, analyzing, and improving systems" },
      { name: "Reality Checker", desc: "Stops fantasy approvals, evidence-based certification - defaults to NEEDS WORK" },
      { name: "Test Results Analyzer", desc: "Expert test analysis specialist in comprehensive test result evaluation, quality metrics" },
      { name: "Tool Evaluator", desc: "Expert technology assessment specialist evaluating, testing, and recommending tools" },
      { name: "Workflow Optimizer", desc: "Expert process improvement specialist analyzing, optimizing, and automating workflows" },
    ]},
  ]},
];

/** Flat lookup: agent name → description */
const AGENCY_AGENT_MAP = new Map<string, string>();
for (const cat of AGENCY_CATALOG) {
  for (const sub of cat.subcategories) {
    for (const a of sub.agents) {
      AGENCY_AGENT_MAP.set(a.name, a.desc);
    }
  }
}

/** Legacy compatibility: flat list of all role names */
const ROLE_PRESETS = AGENCY_CATALOG.flatMap((c) => c.subcategories.flatMap((s) => s.agents.map((a) => a.name)));

/** Skills are now derived from the agent description keywords */
const SKILLS_MAP: Record<string, string[]> = {};
for (const cat of AGENCY_CATALOG) {
  for (const sub of cat.subcategories) {
    for (const a of sub.agents) {
      SKILLS_MAP[a.name] = a.desc.split(/[,/]/).map((s) => s.trim()).filter((s) => s.length > 2 && s.length < 30).slice(0, 8);
    }
  }
}

function RoleSearchSelect({ value, onSelect }: { value: string; onSelect: (role: string) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const query = search.toLowerCase();
  const filtered = query
    ? AGENCY_CATALOG.map((cat) => ({
        ...cat,
        subcategories: cat.subcategories.map((sub) => ({
          ...sub,
          agents: sub.agents.filter((a) =>
            a.name.toLowerCase().includes(query) || a.desc.toLowerCase().includes(query) || cat.label.toLowerCase().includes(query)
          ),
        })).filter((sub) => sub.agents.length > 0),
      })).filter((cat) => cat.subcategories.length > 0)
    : AGENCY_CATALOG;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 14, fontFamily: "monospace",
    border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
    boxSizing: "border-box",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={open ? search : value}
        onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(""); }}
        placeholder="Search roles..."
        style={inputStyle}
      />
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          maxHeight: 250, overflowY: "auto", backgroundColor: "#14112a",
          border: "1px solid #1a2a1a", borderTop: "none",
        }}>
          {filtered.map((cat) =>
            cat.subcategories.map((sub) => (
              <div key={`${cat.category}/${sub.name}`}>
                <div style={{
                  padding: "4px 10px", fontSize: 10, color: "#5a4838",
                  fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em",
                  backgroundColor: "#0a0e0a", position: "sticky", top: 0,
                }}>
                  {cat.subcategories.length > 1 && sub.name !== "_root" ? `${cat.label} > ${sub.label}` : cat.label}
                </div>
                {sub.agents.map((a) => (
                  <div
                    key={a.name}
                    onClick={() => { onSelect(a.name); setOpen(false); setSearch(""); }}
                    style={{
                      padding: "5px 10px", fontSize: 13, fontFamily: "monospace",
                      color: a.name === value ? "#e8b040" : "#eddcb8",
                      cursor: "pointer", backgroundColor: a.name === value ? "#382800" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = "#1a1a2a"; }}
                    onMouseLeave={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    {a.name}
                  </div>
                ))}
              </div>
            ))
          )}
          {filtered.length === 0 && (
            <div
              onClick={() => { onSelect(search.trim()); setOpen(false); setSearch(""); }}
              style={{ padding: "8px 10px", fontSize: 13, fontFamily: "monospace", color: "#7a6858", cursor: "pointer" }}
            >
              Use custom: &quot;{search.trim()}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateAgentModal({ onSave, onClose, assetsReady, editAgent }: {
  onSave: (agent: AgentDefinition) => void;
  onClose: () => void;
  assetsReady?: boolean;
  editAgent?: AgentDefinition | null;
}) {
  const [palette, setPalette] = useState(editAgent?.palette ?? Math.floor(Math.random() * 6));
  const [name, setName] = useState(editAgent?.name ?? (() => {
    const names = ["Alex", "Sam", "Max", "Leo", "Mia", "Kai", "Zoe", "Eli", "Ava", "Jay", "Rio", "Ash", "Sky", "Kit", "Noa", "Rex", "Ivy", "Ace", "Ren", "Jax"];
    return names[Math.floor(Math.random() * names.length)];
  })());

  // Role: preset index (-1 = custom)
  const [rolePresetIndex, setRolePresetIndex] = useState<number>(() => {
    if (!editAgent?.role) return 0;
    const idx = ROLE_PRESETS.indexOf(editAgent.role);
    return idx >= 0 ? idx : -1;
  });
  const [customRole, setCustomRole] = useState(() => {
    if (!editAgent?.role) return "";
    const idx = ROLE_PRESETS.indexOf(editAgent.role);
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
          backgroundColor: TERM_PANEL, padding: "18px 18px 14px",
          width: "90%", maxWidth: 400, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: "0 0 12px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>
          {editAgent ? "Edit Agent" : "Create Agent"}
        </h2>

        {/* Avatar palette selector */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>AVATAR</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                onClick={() => setPalette(p)}
                style={{
                  padding: 3, border: palette === p ? "2px solid #e8b040" : "2px solid #1a2a1a",
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
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>NAME</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
            style={{
              width: "100%", padding: "7px 10px", fontSize: 14, fontFamily: "monospace",
              border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Role — searchable dropdown */}
        <div style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>ROLE</div>
          <RoleSearchSelect
            value={currentRole}
            onSelect={(roleName) => {
              const idx = ROLE_PRESETS.indexOf(roleName);
              if (idx >= 0) {
                handleRoleChange(idx);
              } else {
                // Custom role
                setRolePresetIndex(-1);
                setCustomRole(roleName);
              }
            }}
          />
          {AGENCY_AGENT_MAP.get(currentRole) && (
            <div style={{ fontSize: 11, color: "#5a4838", marginTop: 4, fontFamily: "monospace", lineHeight: 1.4 }}>
              {AGENCY_AGENT_MAP.get(currentRole)}
            </div>
          )}
        </div>

        {/* Skills */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>SKILLS</div>
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
                      padding: "4px 10px", fontSize: 13, fontFamily: "monospace",
                      border: active ? "1px solid #e8b04080" : "1px solid #1a2a1a",
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
                      padding: "4px 10px", fontSize: 13, fontFamily: "monospace",
                      border: "1px solid #5aacff60", backgroundColor: "#182844",
                      color: "#5aacff", display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {skill}
                    <span
                      onClick={() => toggleSkill(skill)}
                      style={{ cursor: "pointer", fontSize: 15, lineHeight: 1, color: "#5aacff80" }}
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
              onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); addCustomSkill(); } }}
              placeholder="Add custom skill..."
              style={{
                flex: 1, padding: "6px 10px", fontSize: 13, fontFamily: "monospace",
                border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={addCustomSkill}
              style={{
                padding: "5px 12px", fontSize: 15, fontWeight: 700,
                border: "1px solid #1a2a1a", backgroundColor: "transparent",
                color: "#7a6858", cursor: "pointer", fontFamily: "monospace",
              }}
            >+</button>
          </div>
        </div>

        {/* Personality */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>PERSONALITY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {PERSONALITY_PRESETS.map((p, i) => (
              <label
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                  cursor: "pointer", fontSize: 13, color: personalityMode === i ? "#eddcb8" : "#7a6858",
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
                cursor: "pointer", fontSize: 13, color: personalityMode === 4 ? "#eddcb8" : "#7a6858",
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
                  width: "100%", padding: "7px 10px", fontSize: 13, fontFamily: "monospace",
                  border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
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
              backgroundColor: "#382800", color: "#e8b040", fontSize: 14,
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
              border: "1px solid #1a2a1a", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function HireModal({ agentDefs, onHire, onCreate, onEdit, onDelete, onClose, assetsReady }: {
  agentDefs: AgentDefinition[];
  onHire: (def: AgentDefinition, backend: string, workDir?: string) => void;
  onCreate: () => void;
  onEdit: (def: AgentDefinition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState<string>("");

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
          backgroundColor: TERM_PANEL, padding: "18px 18px 14px",
          width: "90%", maxWidth: 420, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: "0 0 14px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Agent</h2>

        {/* Backend selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>AI BACKEND</div>
          <div style={{ display: "flex", gap: 4 }}>
            {BACKEND_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBackend(b.id)}
                style={{
                  flex: 1, padding: "6px 4px", fontSize: 13, fontWeight: 600,
                  border: selectedBackend === b.id ? `1px solid ${b.color}` : "1px solid #1a2a1a",
                  backgroundColor: selectedBackend === b.id ? b.color + "20" : "transparent",
                  color: selectedBackend === b.id ? b.color : "#6a5848",
                  cursor: "pointer", fontFamily: "monospace",
                }}
              >{b.name}</button>
            ))}
          </div>
        </div>

        {/* Working directory picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>WORKING DIRECTORY</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="Paste path or click Browse"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12,
                border: "1px solid #1a2a1a", backgroundColor: "#0a0e0a",
                color: "#eddcb8", fontFamily: "monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const rid = nanoid(6);
                folderPickCallbacks.set(rid, (p) => setWorkDir(p));
                sendCommand({ type: "PICK_FOLDER", requestId: rid });
              }}
              style={{
                padding: "6px 10px", border: "1px solid #1a2a1a",
                backgroundColor: "#0a0e0a", color: "#9a8a68",
                fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >Browse</button>
          </div>
          <div style={{ fontSize: 10, color: "#5a4a38", marginTop: 3, fontFamily: "monospace" }}>
            Empty = default workspace
          </div>
        </div>

        {/* Built-in agents */}
        <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>BUILT-IN AGENTS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
          {builtinAgents.map((def) => (
            <button
              key={def.id}
              onClick={() => onHire(def, selectedBackend, workDir || undefined)}
              onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
              onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#1a2a1a"; }}
              title={def.skills ? `Skills: ${def.skills}` : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "12px 6px 10px", position: "relative",
                border: "1px solid #1a2a1a", backgroundColor: "transparent",
                cursor: "pointer", textAlign: "center",
                transition: "border-color 0.15s",
              }}
            >
              <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
              <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
              <div style={{ fontSize: 12, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
              {hoveredId === def.id && (
                <span
                  onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                  style={{ position: "absolute", top: 4, right: 4, fontSize: 15, color: "#7a6858", cursor: "pointer", padding: "2px 4px" }}
                  title="Edit"
                >&#9998;</span>
              )}
            </button>
          ))}
        </div>

        {/* Custom agents */}
        {customAgents.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>MY AGENTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
              {customAgents.map((def) => (
                <button
                  key={def.id}
                  onClick={() => onHire(def, selectedBackend, workDir || undefined)}
                  onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
                  onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#1a2a1a"; }}
                  title={def.skills ? `Skills: ${def.skills}` : undefined}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "12px 6px 10px", position: "relative",
                    border: "1px solid #1a2a1a", backgroundColor: "transparent",
                    cursor: "pointer", textAlign: "center",
                    transition: "border-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 12, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  {hoveredId === def.id && (
                    <span style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2, alignItems: "center" }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                        style={{ fontSize: 15, color: "#7a6858", cursor: "pointer", padding: "2px 4px" }}
                        title="Edit"
                      >&#9998;</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                        style={{ fontSize: 16, color: "#e04848", cursor: "pointer", padding: "2px 4px", fontWeight: 700 }}
                        title="Delete"
                      >&times;</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onCreate}
            style={{
              flex: 1, padding: "9px",
              border: "1px solid #e8b04060", backgroundColor: "transparent",
              color: "#e8b040", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >+ Create New</button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              border: "1px solid #1a2a1a", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ExpandableText({ text, maxChars = 300, maxHeight = 120 }: { text: string; maxChars?: number; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  return (
    <>
      <div style={{
        fontSize: 12, color: "#b09878", wordBreak: "break-word",
        maxHeight: expanded ? "none" : maxHeight, overflow: "hidden", fontFamily: "monospace",
      }}>
        {expanded ? text : text.slice(0, maxChars)}{!expanded && isLong ? "..." : ""}
      </div>
      {isLong && (
        <div
          style={{ fontSize: 10, color: "#6a8aaa", cursor: "pointer", marginTop: 2, fontFamily: "monospace" }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▲ Collapse" : "▼ Show more"}
        </div>
      )}
    </>
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
      <div style={{ textAlign: "center", color: "#5a4838", padding: 30, fontSize: 12, fontFamily: "monospace" }}>
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
              <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
                {msg.fromAgentName ?? msg.fromAgentId}
              </span>
              {msg.toAgentName && (
                <>
                  <span style={{ fontSize: 11, color: "#6a5848" }}>&rarr;</span>
                  {toAgent?.palette !== undefined && (
                    <SpriteAvatar palette={toAgent.palette} zoom={1} ready={assetsReady} />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
                    {msg.toAgentName}
                  </span>
                </>
              )}
              <span style={{
                marginLeft: "auto", fontSize: 9, padding: "1px 4px",
                backgroundColor: cfg.border + "20", color: cfg.border,
                border: `1px solid ${cfg.border}40`, fontFamily: "monospace",
              }}>
                {cfg.label}
              </span>
            </div>
            <ExpandableText text={msgText} maxChars={300} maxHeight={120} />
            <div style={{ fontSize: 10, color: "#5a4838", marginTop: 4, fontFamily: "monospace" }}>
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
function TeamActivityCard({ msg, agents, assetsReady, maxChars = 150, shadow, expandable = false }: {
  msg: TeamChatMessage;
  agents: Map<string, { name: string; palette?: number }>;
  assetsReady?: boolean;
  maxChars?: number;
  shadow?: boolean;
  expandable?: boolean;
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
        <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
          {msg.fromAgentName ?? msg.fromAgentId}
        </span>
        {msg.toAgentName && (
          <>
            <span style={{ fontSize: 11, color: "#6a5848" }}>&rarr;</span>
            {toAgent?.palette !== undefined && (
              <SpriteAvatar palette={toAgent.palette} zoom={1} ready={assetsReady} />
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: "#eddcb8" }}>
              {msg.toAgentName}
            </span>
          </>
        )}
        <span style={{
          marginLeft: "auto", fontSize: 9, padding: "1px 4px",
          backgroundColor: cfg.border + "20", color: cfg.border,
          border: `1px solid ${cfg.border}40`, fontFamily: "monospace",
        }}>
          {cfg.label}
        </span>
      </div>
      {expandable
        ? <ExpandableText text={msgText} maxChars={maxChars} maxHeight={80} />
        : (
          <div style={{
            fontSize: 12, color: "#b09878", wordBreak: "break-word",
            maxHeight: 80, overflow: "hidden", fontFamily: "monospace",
          }}>
            {msgText.slice(0, maxChars)}{msgText.length > maxChars ? "..." : ""}
          </div>
        )
      }
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
      borderTop: "1px solid #152515",
      padding: "6px 0",
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: "4px 12px 6px",
          fontSize: 10, color: "#6a5848", fontFamily: "monospace",
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
              marginLeft: "auto", fontSize: 9, padding: "1px 5px",
              color: "#7a6858", border: "1px solid #1a2a1a80",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#e04848"; e.currentTarget.style.borderColor = "#e0484880"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#7a6858"; e.currentTarget.style.borderColor = "#1a2a1a80"; }}
          >CLEAR</span>
        )}
      </div>
      {!collapsed && (
        <div style={{ overflowY: "auto", maxHeight: "30vh", padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {messages.map((msg, i) => {
            if (!msg || !msg.fromAgentId) return null;
            return (
              <TeamActivityCard key={msg.id ?? `tc-${i}`} msg={msg} agents={agents} assetsReady={assetsReady} expandable />
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
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  const [selectedDevId, setSelectedDevId] = useState<string>(devAgents[0]?.id ?? "");
  const [backends, setBackends] = useState<Record<string, string>>({});
  const [workDir, setWorkDir] = useState<string>("");

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [];
    if (selectedDevId) memberIds.push(selectedDevId);
    if (reviewer) memberIds.push(reviewer.id);
    onCreateTeam(leader.id, memberIds, backends, workDir || undefined);
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
          backgroundColor: TERM_PANEL, padding: "18px 18px 14px",
          width: "90%", maxWidth: 440, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: "0 0 14px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Team</h2>

        {/* Working directory picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>PROJECT DIRECTORY</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="Paste path or click Browse"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12,
                border: "1px solid #1a2a1a", backgroundColor: "#0a0e0a",
                color: "#eddcb8", fontFamily: "monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const rid = nanoid(6);
                folderPickCallbacks.set(rid, (p) => setWorkDir(p));
                sendCommand({ type: "PICK_FOLDER", requestId: rid });
              }}
              style={{
                padding: "6px 10px", border: "1px solid #1a2a1a",
                backgroundColor: "#0a0e0a", color: "#9a8a68",
                fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >Browse</button>
          </div>
          <div style={{ fontSize: 10, color: "#5a4a38", marginTop: 3, fontFamily: "monospace" }}>
            Empty = default workspace
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
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
                <div style={{ fontSize: 15, fontWeight: 700, color: "#eddcb8" }}>
                  {def.name} <span style={{ color: "#e89030", fontSize: 11, fontFamily: "monospace" }}>{label}</span>
                </div>
                <div style={{ fontSize: 13, color: "#7a6858" }}>{def.role}</div>
              </div>
              <select
                value={backends[def.id] ?? "claude"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
                style={{
                  padding: "3px 6px", border: "1px solid #1a2a1a",
                  backgroundColor: "#0a0e0a", color: "#9a8a68", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                }}
              >
                {BACKEND_OPTIONS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ))}

          {/* Dev cards — single select grid */}
          <div style={{ fontSize: 12, color: "#7a6858", marginTop: 4, marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>DEV AGENT (pick 1)</div>
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
                    border: selected ? "1px solid #e8b04060" : "1px solid #1a2a1a",
                    backgroundColor: selected ? "#2a2200" : "transparent",
                    cursor: "pointer", textAlign: "center",
                    opacity: selected ? 1 : 0.5,
                    transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 12, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  <select
                    value={backends[def.id] ?? "claude"}
                    onClick={(e) => { e.stopPropagation(); setSelectedDevId(def.id); }}
                    onChange={(e) => { setSelectedDevId(def.id); setBackends((prev) => ({ ...prev, [def.id]: e.target.value })); }}
                    style={{
                      marginTop: 6, padding: "3px 6px", border: "1px solid #1a2a1a",
                      backgroundColor: "#0a0e0a", color: "#9a8a68", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
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
              backgroundColor: "#382800", color: "#e8b040", fontSize: 14,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              opacity: leader ? 1 : 0.4,
            }}
            disabled={!leader}
          >Create Team</button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              border: "1px solid #1a2a1a", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo script — simulates a team working session for GIF recording
// ---------------------------------------------------------------------------
function runDemoScript(onDone: () => void) {
  const store = useOfficeStore;
  const h = (event: Parameters<ReturnType<typeof useOfficeStore.getState>["handleEvent"]>[0]) =>
    store.getState().handleEvent(event);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  const LEADER = "demo-leader";
  const DEV = "demo-dev";
  const REVIEWER = "demo-reviewer";
  const TEAM = "demo-team";
  let ts = Date.now();
  const tick = () => ts++;

  const chat = (from: string, msg: string, type: "delegation" | "result" | "status" = "status", to?: string) =>
    h({ type: "TEAM_CHAT", fromAgentId: from, toAgentId: to, message: msg, messageType: type, timestamp: tick() });

  const log = (agentId: string, text: string) =>
    h({ type: "LOG_APPEND", agentId, taskId: "demo-task", stream: "stdout", chunk: text });

  // 0s — Create 3 agents
  h({ type: "AGENT_CREATED", agentId: LEADER, name: "Ash (Leader)", role: "Team Leader", teamId: TEAM, isTeamLead: true, palette: 0, isExternal: false });
  h({ type: "AGENT_CREATED", agentId: DEV, name: "Leo", role: "Developer", teamId: TEAM, palette: 1, isExternal: false });
  h({ type: "AGENT_CREATED", agentId: REVIEWER, name: "Mae", role: "Code Reviewer", teamId: TEAM, palette: 2, isExternal: false });

  // 0.5s — All agents sit at desks
  at(500, () => {
    h({ type: "AGENT_STATUS", agentId: LEADER, status: "working" });
    h({ type: "AGENT_STATUS", agentId: DEV, status: "working" });
    h({ type: "AGENT_STATUS", agentId: REVIEWER, status: "working" });
  });

  // 2s — Leader announces plan
  at(2000, () => chat(LEADER, "Alright team! Let's build a space shooter game with PixiJS."));

  // 5s — Leader delegates to dev
  at(5000, () => chat(LEADER, "Build the complete game — player controls, enemies, scoring, and sound effects.", "delegation", DEV));

  // 8s — Leader delegates to reviewer
  at(8000, () => chat(LEADER, "Stand by to review Leo's code when he's done.", "delegation", REVIEWER));

  // 11s — Dev progress
  at(11000, () => log(DEV, "Setting up project structure"));

  // 14s — Dev progress
  at(14000, () => log(DEV, "Building player ship and controls"));

  // 17s — Dev progress
  at(17000, () => log(DEV, "Adding enemy waves and collision"));

  // 20s — Dev progress
  at(20000, () => log(DEV, "Implementing score system and UI"));

  // 23s — Dev finishes
  at(23000, () => {
    log(DEV, "Build passed. All files verified.");
    chat(DEV, "Space shooter complete — 5 enemy types, power-ups, and high score system.", "result");
  });

  // 26s — Reviewer starts
  at(26000, () => log(REVIEWER, "Checking file structure"));

  // 29s — Reviewer progress
  at(29000, () => log(REVIEWER, "Reading game logic and collision detection"));

  // 32s — Reviewer passes
  at(32000, () => chat(REVIEWER, "VERDICT: PASS — Clean code, smooth gameplay loop, all features working.", "result"));

  // 35s — Leader wraps up
  at(35000, () => chat(LEADER, "Great work everyone! The space shooter is ready to ship.", "result"));

  // 39s — Cleanup
  at(39000, () => {
    h({ type: "AGENT_FIRED", agentId: LEADER });
    h({ type: "AGENT_FIRED", agentId: DEV });
    h({ type: "AGENT_FIRED", agentId: REVIEWER });
    // Clear team messages
    store.setState({ teamMessages: [] });
    onDone();
  });
}

// Per-agent working directory map (persists across renders, not in state to avoid re-renders)
const agentWorkDirMap = new Map<string, string>();

export default function OfficePage() {
  const router = useRouter();
  const { agents, connected, addUserMessage, teamMessages, clearTeamMessages, teamPhases, agentDefs, role, suggestions, setRole } = useOfficeStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRatings, setPreviewRatings] = useState<Ratings>({});
  const [previewRated, setPreviewRated] = useState(false);
  const [celebration, setCelebration] = useState<{ previewUrl?: string; previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const { confirm, modal: confirmModal } = useConfirm();
  const [showHireModal, setShowHireModal] = useState(false);
  const [showHireTeamModal, setShowHireTeamModal] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTeamOpen, setMobileTeamOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"team" | "agents" | "external">("agents");
  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<{ name: string; dataUrl: string; base64: string }[]>([]);
  const pasteMapRef = useRef(new Map<string, string>()); // label → full text
  const pasteCountRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Editor state
  const [editMode, setEditMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOfficeSwitcher, setShowOfficeSwitcher] = useState(false);
  const [currentOfficeId, setCurrentOfficeId] = useState<string | null>(null);
  const [showEditorControls, setShowEditorControls] = useState(false);
  const [testActive, setTestActive] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [showDemoButton, setShowDemoButton] = useState(false);
  const showTestButton = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test');
  useEffect(() => {
    setShowDemoButton(new URLSearchParams(window.location.search).has('demo'));
  }, []);
  const [mapAspect, setMapAspect] = useState(1); // cols/rows ratio for scene width
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [, forceUpdate] = useState(0);
  const editorRef = useRef(new EditorState());
  const officeStateRef = useRef<OfficeState | null>(null);
  const [sceneAdapter, setSceneAdapter] = useState<SceneAdapter | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [assetsReady, setAssetsReady] = useState(false);

  // ── Theme ──
  // Always start with default to avoid SSR/client hydration mismatch,
  // then restore saved theme in useEffect (client-only).
  const [termTheme, setTermTheme] = useState("green-hacker");
  applyTermTheme(termTheme);
  useEffect(() => {
    const saved = localStorage.getItem("bit-office-theme");
    if (saved && saved !== "green-hacker" && TERM_THEMES[saved]) {
      setTermTheme(saved);
    }
  }, []);
  useEffect(() => {
    applyTermTheme(termTheme);
    localStorage.setItem("bit-office-theme", termTheme);
  }, [termTheme]);

  // Bridge store → scene adapter
  useSceneBridge(sceneAdapter, selectedAgent);

  // Gateway may override preview URL (e.g. auto-detected Vite dev server)
  const pendingPreviewUrl = useOfficeStore(s => s.pendingPreviewUrl);
  useEffect(() => {
    if (pendingPreviewUrl && previewUrl) {
      setPreviewUrl(pendingPreviewUrl);
      useOfficeStore.getState().consumePreviewUrl();
    }
  }, [pendingPreviewUrl, previewUrl]);

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
        if (r.changedFiles.length === 0 && r.testResult === "unknown" && !r.previewUrl && !r.previewCmd && !r.previewPath) continue;
        // Team member → never celebrate
        if (agentState.teamId && !agentState.isTeamLead) continue;
        // Team leader → only celebrate when isFinalResult is explicitly true
        if (agentState.isTeamLead && !msg.isFinalResult) continue;
        // Solo agent or leader with isFinalResult → celebrate
        setCelebration({ previewUrl: r.previewUrl, previewPath: r.previewPath, previewCmd: r.previewCmd, previewPort: r.previewPort, projectDir: r.projectDir, entryFile: r.entryFile });
        setPreviewRatings({});
        setPreviewRated(false);
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

  /** Fit zoom for a given layout — renderer already centers the map, so just reset pan */
  const fitZoomToLayout = useCallback((layout: import('@/components/office/types').OfficeLayout) => {
    const canvas = document.querySelector('canvas');
    if (!canvas?.parentElement) return;
    const viewW = canvas.parentElement.clientWidth;
    const viewH = canvas.parentElement.clientHeight;
    const mapW = layout.cols * TILE_SIZE;
    const mapH = layout.rows * TILE_SIZE;
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(viewW / mapW, viewH / mapH, ZOOM_MAX));
    panRef.current = { x: 0, y: 0 };
  }, [zoomRef, panRef]);

  const handleImportRoomZip = useCallback((layout: import('@/components/office/types').OfficeLayout, backgroundImage: HTMLImageElement | null) => {
    const office = officeStateRef.current;
    if (!office) return;
    office.setBackgroundImage(backgroundImage);
    handleImportLayout(layout);
    setMapAspect(layout.cols / layout.rows);
    // Recalc zoom after React re-render + container resize settles
    requestAnimationFrame(() => requestAnimationFrame(() => fitZoomToLayout(layout)));
  }, [officeStateRef, handleImportLayout, fitZoomToLayout]);

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

  // Load office zip on mount (always from /offices/)
  const handleAssetsLoaded = useCallback(async () => {
    const office = officeStateRef.current;
    if (office) {
      try {
        const { loadDefaultOffice } = await import("@/components/office/ui/OfficeSwitcher");
        const result = await loadDefaultOffice();
        if (result) {
          office.setBackgroundImage(result.backgroundImage);
          handleImportLayout(result.layout);
          setCurrentOfficeId(result.officeId);
          setMapAspect(result.layout.cols / result.layout.rows);
          // Recalc zoom after React re-render + container resize settles
          requestAnimationFrame(() => requestAnimationFrame(() => fitZoomToLayout(result.layout)));
        }
      } catch (err) {
        console.warn('[OfficePage] Failed to load default office zip:', err);
      }
    }
    setAssetsReady(true);
  }, []);

  const handleAdapterReady = useCallback((adapter: SceneAdapter) => {
    setSceneAdapter(adapter);
  }, []);

  useEffect(() => {
    const conn = getConnection();
    if (!conn || !conn.sessionToken) {
      if (conn && !conn.sessionToken) {
        const { clearConnection } = require("@/lib/storage");
        clearConnection();
      }
      router.push("/pair");
      return;
    }

    // Re-detect gateway port instead of using stale stored wsUrl
    const detectAndConnect = async () => {
      setRole(conn.role ?? "owner");
      useOfficeStore.getState().hydrate();

      // If mode is ably, use stored info as-is
      if (conn.mode === "ably") {
        return connect(conn);
      }

      // For ws mode: detect live gateway port
      const isDev = window.location.port === "3000" || window.location.port === "3002";
      const ports = isDev ? [9099, 9090, 9091] : [9090, 9091, 9099];

      // Try same-origin first (production bundled mode)
      if (!isDev) {
        try {
          const res = await fetch(`${window.location.origin}/connect`, { signal: AbortSignal.timeout(500) });
          if (res.ok) {
            const data = await res.json();
            const freshConn = { ...conn, wsUrl: window.location.origin.replace(/^http/, "ws"), sessionToken: data.sessionToken };
            const { saveConnection } = await import("@/lib/storage");
            saveConnection(freshConn);
            return connect(freshConn);
          }
        } catch { /* not bundled mode */ }
      }

      // Scan preferred ports
      for (const port of ports) {
        try {
          const res = await fetch(`http://localhost:${port}/connect`, { signal: AbortSignal.timeout(1000) });
          if (!res.ok) continue;
          const data = await res.json();
          const freshConn = { ...conn, wsUrl: `ws://localhost:${port}`, sessionToken: data.sessionToken };
          const { saveConnection } = await import("@/lib/storage");
          saveConnection(freshConn);
          return connect(freshConn);
        } catch { /* try next */ }
      }

      // Fallback to stored wsUrl
      return connect(conn);
    };

    let scopedDisconnect: (() => void) | undefined;
    detectAndConnect().then((d) => { scopedDisconnect = d; });
    return () => { scopedDisconnect?.(); };
  }, [router, setRole]);

  const selectedAgentState = selectedAgent ? agents.get(selectedAgent) : null;
  const isAgentBusy = selectedAgentState?.status === "working" || selectedAgentState?.status === "waiting_approval";

  // Auto-scroll: follow content growth unless user scrolled up
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let userScrolledUp = false;
    const scrollToBottom = () => {
      if (!userScrolledUp) container.scrollTop = container.scrollHeight;
    };
    const onScroll = () => {
      userScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > 80;
    };
    // MutationObserver catches everything: new elements, text changes, typewriter reveals
    let scrollRaf = 0;
    const throttledScroll = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; scrollToBottom(); });
    };
    const observer = new MutationObserver(throttledScroll);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    container.addEventListener("scroll", onScroll);
    scrollToBottom();
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [selectedAgent]);

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
    const agent = agents.get(agentId);
    if (agent) {
      if (agent.isExternal) {
        setExpandedSection("external");
      } else if (agent.teamId) {
        setExpandedSection("team");
      } else {
        setExpandedSection("agents");
      }
    }
  }, [agents]);

  const handleHire = useCallback((def: AgentDefinition, backend: string, workDir?: string) => {
    const existing = Array.from(agents.values()).filter(
      (a) => a.name === def.name || a.name.match(new RegExp(`^${def.name} \\d+$`))
    );
    const displayName = existing.length === 0 ? def.name : `${def.name} ${existing.length + 1}`;
    const agentId = `agent-${nanoid(6)}`;
    sendCommand({ type: "CREATE_AGENT", agentId, name: displayName, role: def.skills ? `${def.role} — ${def.skills}` : def.role, palette: def.palette, personality: def.personality, backend, workDir });
    // Store workDir locally so RUN_TASK can pass it as repoPath
    if (workDir) {
      agentWorkDirMap.set(agentId, workDir);
    }
    setSelectedAgent(agentId);
    setChatOpen(true);
    setExpandedSection("agents");
    setShowHireModal(false);
  }, [agents]);

  const handleCreateTeam = useCallback((leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string) => {
    sendCommand({ type: "CREATE_TEAM", leadId, memberIds, backends, workDir });
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
    setShowHireModal(true);
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

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const ext = file.name.split(".").pop() || "png";
      const name = `image-${nanoid(6)}.${ext}`;
      setPendingImages((prev) => [...prev, { name, dataUrl, base64 }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
        return;
      }
    }
  }, [addImageFromFile]);

  const handlePasteText = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      const lines = text.split("\n");
      if (lines.length > 3 || text.length > 200) {
        e.preventDefault();
        pasteCountRef.current++;
        const info = lines.length > 1 ? `+${lines.length} lines` : `${text.length} chars`;
        const label = `[Pasted text #${pasteCountRef.current} ${info}]`;
        pasteMapRef.current.set(label, text);
        const input = e.currentTarget;
        const pos = input.selectionStart ?? prompt.length;
        setPrompt(prev => prev.slice(0, pos) + label + prev.slice(pos));
      }
    }
  }, [prompt]);

  const handleDropImage = useCallback((e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const handleRunTask = useCallback(async () => {
    if (!selectedAgent || (!prompt.trim() && pendingImages.length === 0)) return;
    const agent = agents.get(selectedAgent);
    if (agent?.isExternal) return;

    // Upload images first, collect paths
    const imagePaths: string[] = [];
    if (pendingImages.length > 0) {
      const uploads = pendingImages.map((img) => {
        return new Promise<string>((resolve) => {
          const rid = nanoid(6);
          imageUploadCallbacks.set(rid, resolve);
          sendCommand({ type: "UPLOAD_IMAGE", requestId: rid, data: img.base64, filename: img.name });
          // Timeout fallback
          setTimeout(() => { imageUploadCallbacks.delete(rid); resolve(""); }, 5000);
        });
      });
      const paths = await Promise.all(uploads);
      for (const p of paths) { if (p) imagePaths.push(p); }
    }

    // Expand pasted text labels back to full content
    let finalPrompt = prompt.trim();
    for (const [label, fullText] of pasteMapRef.current) {
      finalPrompt = finalPrompt.replace(label, fullText);
    }
    if (imagePaths.length > 0) {
      finalPrompt += (finalPrompt ? "\n\n" : "") + imagePaths.map((p) => `[Attached image: ${p}]`).join("\n");
    }
    finalPrompt = finalPrompt.trim();

    const taskId = nanoid();
    const displayText = finalPrompt;
    addUserMessage(selectedAgent, taskId, displayText);
    const repoPath = agentWorkDirMap.get(selectedAgent);
    sendCommand({
      type: "RUN_TASK",
      agentId: selectedAgent,
      taskId,
      prompt: finalPrompt,
      repoPath,
      name: agent?.name,
      role: agent?.role,
      personality: agent?.personality,
    });
    setPrompt("");
    setPendingImages([]);
    pasteMapRef.current.clear();
  }, [selectedAgent, prompt, pendingImages, addUserMessage, agents]);

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
    const agentState = agents.get(selectedAgent);
    sendCommand({
      type: "END_PROJECT",
      agentId: selectedAgent,
      name: agentState?.name,
      role: agentState?.role,
      personality: agentState?.personality,
      backend: agentState?.backend,
    });
    clearTeamMessages();
  }, [selectedAgent, agents, clearTeamMessages]);

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

  const isOwner = role === "owner";
  const isCollaborator = role === "collaborator";
  const isSpectator = role === "spectator";
  const [suggestText, setSuggestText] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleSuggest = useCallback(() => {
    if (!suggestText.trim()) return;
    sendCommand({ type: "SUGGEST", text: suggestText.trim() });
    setSuggestText("");
  }, [suggestText]);

  const [showShareMenu, setShowShareMenu] = useState(false);
  const [consoleMode, setConsoleMode] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(true); // delays scene mount until collapse animation ends

  const handleCreateShareLink = useCallback(async (shareRole: "collaborator" | "spectator") => {
    try {
      const { getGatewayHttpUrl } = await import("@/lib/storage");
      const baseUrl = getGatewayHttpUrl();
      // Share creation uses the pair code. We prompt the user to enter it.
      const code = window.prompt("Enter your pair code to create a share link:");
      if (!code) return;
      const res = await fetch(`${baseUrl}/share/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), role: shareRole }),
      });
      if (res.ok) {
        const data = await res.json();
        const url = `${window.location.origin}/join?token=${data.token}&gateway=${encodeURIComponent(baseUrl)}`;
        setShareUrl(url);
        navigator.clipboard?.writeText(url).catch(() => {});
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to create share link");
      }
    } catch (err) {
      console.error("[Share] Failed to create share link:", err);
    }
    setShowShareMenu(false);
  }, []);

  const isChatExpanded = chatOpen && selectedAgent !== null;

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative", overflow: "hidden", display: "flex" }}>
      {/* Game Scene — fills remaining space after sidebar, centered */}
      {sceneVisible && !consoleMode && <div style={{ flex: 1, position: "relative", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginRight: "calc(min(40vw, 800px) + 30px)" }}>
        {/* Loading overlay — fades out to reveal scene */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 5,
          backgroundColor: "#16122a",
          animation: "scene-overlay-fadeout 2s ease-out 0.1s forwards",
          pointerEvents: "none",
        }} />
        <div style={{ width: `min(100%, calc(100vh * ${mapAspect}))`, height: `min(100%, calc(100vw / ${mapAspect}))`, aspectRatio: `${mapAspect}`, position: "relative", maxHeight: "100vh" }}>
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

        {/* Loading overlay — covers canvas until office ZIP is loaded */}
        <LoadingOverlay visible={!assetsReady} />

        {/* Top-left status bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
          background: "linear-gradient(to bottom, rgba(22,18,42,0.90) 0%, rgba(22,18,42,0) 100%)",
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
            <h1 className="px-font" style={{ fontSize: 12, margin: 0, color: "#e8b040", textShadow: "2px 2px 0px rgba(0,0,0,0.8), 0 0 12px rgba(200,155,48,0.3)", letterSpacing: "0.05em" }}>Bit Office</h1>
            <span style={{
              fontSize: 10, padding: "3px 7px",
              border: `1px solid ${connected ? "#2a5c2a" : "#5c1a1a"}`,
              backgroundColor: connected ? "#143a14" : "#3e1818",
              color: connected ? "#48cc6a" : "#e04848",
              fontFamily: "monospace", letterSpacing: "0.05em",
            }}>
              {connected ? "● ONLINE" : "● OFFLINE"}
            </span>
            {editMode && (
              <span style={{
                fontSize: 10, padding: "3px 7px",
                border: "1px solid #5a3a10",
                backgroundColor: "#1a0e00", color: "#e8b040",
                fontFamily: "monospace",
              }}>
                EDIT MODE
              </span>
            )}
            {isSpectator && (
              <span style={{
                fontSize: 10, padding: "3px 7px",
                border: "1px solid #3b82f6",
                backgroundColor: "#1a2744", color: "#7ab8f5",
                fontFamily: "monospace", letterSpacing: "0.05em",
              }}>
                WATCHING
              </span>
            )}
            {isCollaborator && (
              <span style={{
                fontSize: 10, padding: "3px 7px",
                border: "1px solid #a855f7",
                backgroundColor: "#2d1a44", color: "#c084fc",
                fontFamily: "monospace", letterSpacing: "0.05em",
              }}>
                COLLABORATOR
              </span>
            )}
            {isOwner && (
              <div style={{ position: "relative" }}>
                <span
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  style={{
                    fontSize: 10, padding: "3px 7px", cursor: "pointer",
                    border: "1px solid #a855f760",
                    backgroundColor: showShareMenu ? "#a855f720" : "transparent", color: "#c084fc",
                    fontFamily: "monospace", letterSpacing: "0.05em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#a855f720"; }}
                  onMouseLeave={(e) => { if (!showShareMenu) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  SHARE
                </span>
                {showShareMenu && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
                    backgroundColor: TERM_PANEL, border: "1px solid #1a2a1a",
                    display: "flex", flexDirection: "column", minWidth: 160,
                  }}>
                    <button
                      onClick={() => handleCreateShareLink("collaborator")}
                      style={{
                        padding: "8px 12px", border: "none", backgroundColor: "transparent",
                        color: "#c084fc", fontSize: 12, cursor: "pointer", textAlign: "left",
                        fontFamily: "monospace",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#a855f720"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >Collaborator link</button>
                    <button
                      onClick={() => handleCreateShareLink("spectator")}
                      style={{
                        padding: "8px 12px", border: "none", backgroundColor: "transparent",
                        color: "#7ab8f5", fontSize: 12, cursor: "pointer", textAlign: "left",
                        fontFamily: "monospace",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#3b82f620"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >Spectator link</button>
                  </div>
                )}
              </div>
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
            onOpenHistory={() => setShowHistory(true)}
            onOpenOfficeSwitcher={() => setShowOfficeSwitcher(true)}
            showEditorControls={showEditorControls}
            testActive={testActive}
            onToggleTest={showTestButton ? () => {
              const office = officeStateRef.current;
              if (!office) return;
              if (office.hasTestCharacters()) {
                office.clearTestCharacters();
                setTestActive(false);
              } else {
                office.spawnTestCharacters();
                setTestActive(true);
              }
            } : undefined}
          />
        )}

        {/* Team activity toast notifications */}
        {teamMessages.length > 0 && (
          <TeamActivityToast messages={teamMessages} agents={agents} assetsReady={assetsReady} />
        )}

        </div>
      </div>}

      {/* ── Right Sidebar (desktop only) — takes remaining space after game scene ── */}
      {!isMobile && <>

        <div className="term-dotgrid" style={{
          position: "fixed",
          right: 0,
          top: 0,
          width: consoleMode ? "100vw" : "min(40vw, 800px)",
          minWidth: 260,
          height: "100vh",
          backgroundColor: TERM_PANEL,
          border: "none",
          borderLeft: consoleMode ? undefined : `1px solid ${TERM_GREEN}15`,
          boxShadow: consoleMode ? "none" : TERM_GLOW_BORDER,
          display: "flex",
          flexDirection: "row",
          overflow: "visible",
          transition: "width 0.3s ease",
          zIndex: 10,
        }}>

          {/* ── Bookmark tabs — absolutely positioned to the left of sidebar ── */}
          <div style={{
            position: "absolute",
            left: consoleMode ? 0 : undefined,
            right: consoleMode ? undefined : "100%",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            alignItems: consoleMode ? "flex-start" : "flex-end",
            gap: 2,
            transition: "opacity 0.15s ease",
            opacity: consoleMode || sceneVisible ? 1 : 0,
            pointerEvents: consoleMode || sceneVisible ? "auto" : "none",
          }}>
          {/* Bookmark tabs */}
          {[
            { key: "agents" as const, label: "Agents", color: "#c8a050" },
            { key: "team" as const, label: "Team", color: "#d09040" },
            { key: "external" as const, label: "Ext", color: "#b87830" },
          ].map((tab) => {
            const active = expandedSection === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setExpandedSection(tab.key);
                  const list = tab.key === "agents" ? soloAgents : tab.key === "team" ? teamAgents : externalAgents;
                  if (list.length > 0) { setSelectedAgent(list[0].agentId); setChatOpen(true); }
                }}
                style={{
                  writingMode: "vertical-lr",
                  textOrientation: "mixed",
                  padding: "0 5px",
                  height: 72,
                  border: "none", cursor: "pointer",
                  background: active ? tab.color + "20" : TERM_PANEL + "80",
                  borderRadius: consoleMode ? "0 6px 6px 0" : "6px 0 0 6px",
                  borderTop: `1px solid ${active ? tab.color + "60" : tab.color + "40"}`,
                  borderBottom: `1px solid ${active ? tab.color + "60" : tab.color + "40"}`,
                  borderLeft: consoleMode ? "none" : `1px solid ${active ? tab.color + "60" : tab.color + "40"}`,
                  borderRight: consoleMode ? `1px solid ${active ? tab.color + "60" : tab.color + "40"}` : "none",
                  color: active ? tab.color : "#5a5a5a",
                  fontSize: 13, fontFamily: TERM_FONT, fontWeight: 600,
                  letterSpacing: "0.1em",
                  boxShadow: active ? `0 2px 8px ${tab.color}15, inset 0 -4px 8px ${tab.color}08` : "2px 0 8px rgba(0,0,0,0.4)",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = tab.color; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#5a5a5a"; }}
              >
                {tab.label}
              </button>
            );
          })}

          {/* Arrow button */}
          <button
            onClick={() => {
              if (consoleMode) {
                // Collapsing: animate sidebar first, then mount scene after transition
                setConsoleMode(false);
                setTimeout(() => setSceneVisible(true), 320);
              } else {
                // Expanding: hide scene immediately, then expand
                setSceneVisible(false);
                requestAnimationFrame(() => setConsoleMode(true));
              }
            }}
            style={{
              width: 28, height: 40, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0, marginTop: 4,
              background: TERM_PANEL + "80",
              borderRadius: consoleMode ? "0 10px 10px 0" : "10px 0 0 10px",
              borderTop: "1px solid #e8b04040",
              borderBottom: "1px solid #e8b04040",
              borderLeft: consoleMode ? "none" : "1px solid #e8b04040",
              borderRight: consoleMode ? "1px solid #e8b04040" : "none",
              boxShadow: "-2px 0 8px rgba(0,0,0,0.3)",
              color: "#e8b040", fontSize: 14,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#2a2444"; e.currentTarget.style.color = "#f0c860"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = TERM_PANEL + "80"; e.currentTarget.style.color = "#e8b040"; }}
            title={consoleMode ? "Back to Office" : "Console Mode"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: consoleMode ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }}>
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Theme picker */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, alignItems: "center", marginLeft: consoleMode ? 6 : 0 }}>
            {Object.entries(TERM_THEMES).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => setTermTheme(key)}
                title={theme.name}
                style={{
                  width: 10, height: 10, borderRadius: "50%", padding: 0,
                  border: termTheme === key ? `2px solid ${theme.accent}` : "1px solid #444",
                  backgroundColor: theme.accent,
                  cursor: "pointer",
                  opacity: termTheme === key ? 1 : 0.4,
                  transition: "all 0.15s",
                  boxShadow: termTheme === key ? `0 0 6px ${theme.accent}60` : "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { if (termTheme !== key) e.currentTarget.style.opacity = "0.4"; }}
              />
            ))}
          </div>
          </div>
          {/* ── Main content area ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, width: consoleMode ? "90%" : undefined, maxWidth: consoleMode ? "90%" : undefined, margin: consoleMode ? "10px auto" : undefined, border: consoleMode ? `1px solid ${TERM_GREEN}20` : undefined, borderRadius: consoleMode ? 8 : undefined }}>

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
                  flex: isExpanded ? 1 : undefined,
                  minHeight: isExpanded ? 0 : undefined,
                  border: "none",
                  backgroundColor: "transparent",
                }}>
                  {/* Agent info bar */}
                  <div
                    style={{
                      display: isExpanded ? "flex" : "none",
                      alignItems: "center", gap: 10,
                      padding: "6px 14px",
                      background: "rgba(6,10,6,0.85)",
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                      boxShadow: `0 1px 0 ${TERM_GREEN}08, inset 0 1px 0 rgba(24,255,98,0.06)`,
                      borderBottom: `1px solid ${TERM_GREEN}08`,
                      fontSize: 12, fontFamily: TERM_FONT,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: "#c8a050", fontWeight: 600, flexShrink: 0, fontSize: 12 }}>
                      {agent.role?.split("—")[0]?.trim()}
                      {agent.backend && <span style={{ color: "#8a7040", fontSize: 11 }}> ({BACKEND_OPTIONS.find((b) => b.id === agent.backend)?.name ?? agent.backend})</span>}
                    </span>
                    {(agentState?.cwd || agentState?.workDir) && (
                      <span className="term-path-scroll" style={{ fontSize: 11, color: "#7a6848", flexShrink: 1, minWidth: 0 }} title={agentState.cwd ?? agentState.workDir}>
                        {agentState.cwd ?? agentState.workDir}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ color: cfg.color, fontSize: 11, flexShrink: 0, fontWeight: 500 }}>{cfg.label}</span>
                    {agentState && agentState.tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={agentState.tokenUsage.inputTokens} outputTokens={agentState.tokenUsage.outputTokens} />}
                    {!agentState?.teamId && isOwner && (
                      <span
                        onClick={(e) => { e.stopPropagation(); handleFire(agent.agentId); }}
                        style={{
                          fontSize: 12, color: "#c04040", cursor: "pointer", lineHeight: 1,
                          padding: "4px", flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ff4040"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#c04040"; }}
                      >{"\u2715"}</span>
                    )}
                  </div>

                  {/* Expanded: hybrid panel for external agents (info header + messages) */}
                  {isExpanded && agentState && isExternal && (
                    <div style={{
                      flex: 1,
                      display: "flex", flexDirection: "column",
                      backgroundColor: TERM_BG,
                      minHeight: 0,
                      overflow: "hidden",
                    }}>
                      {/* Compact info header */}
                      <div style={{
                        padding: "8px 12px",
                        boxShadow: "0 1px 0 rgba(26,42,26,0.5)",
                        background: "rgba(10,14,10,0.75)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        flexShrink: 0,
                      }}>
                        <div style={{ fontSize: TERM_SIZE, color: TERM_GREEN, opacity: 0.6, marginBottom: 4, fontFamily: TERM_FONT, letterSpacing: "0.05em" }}>
                          EXTERNAL PROCESS
                        </div>
                        <div style={{ display: "flex", gap: 12, fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT, flexWrap: "wrap" }}>
                          <span>{agentState.backend ?? "unknown"}</span>
                          <span>PID {agentState.pid ?? "\u2014"}</span>
                          <span className="term-path-scroll" title={agentState.cwd ?? undefined} style={{ maxWidth: 300 }}>
                            {agentState.cwd ?? "\u2014"}
                          </span>
                        </div>
                      </div>

                      {/* Scrollable messages */}
                      <div className="crt-screen" style={{
                        flex: 1, overflowY: "auto", padding: "8px 10px",
                        display: "flex", flexDirection: "column",
                        minHeight: 0,
                      }}>
                        {agentState.messages.length === 0 && (
                          <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 13 }}>
                            Waiting for output...
                          </div>
                        )}
                        {agentState.messages.map((msg) => (
                          <MessageBubble key={msg.id} msg={msg} agentName={agentState?.name} />
                        ))}
                        <div ref={chatEndRef} />
                      </div>

                      {/* Read-only footer */}
                      <div style={{
                        padding: "6px 12px",
                        backgroundColor: TERM_SURFACE,
                        fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT,
                        textAlign: "center", flexShrink: 0,
                      }}>
                        Read-only — this process is running externally
                      </div>
                    </div>
                  )}
                  {isExpanded && agentState && !isExternal && (
                    <div
                      onPaste={handlePasteImage}
                      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.currentTarget.style.outline = "2px solid #e8b04060"; } }}
                      onDragLeave={(e) => { e.currentTarget.style.outline = "none"; }}
                      onDrop={(e) => { e.currentTarget.style.outline = "none"; handleDropImage(e); }}
                      className="crt-screen"
                      style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      backgroundColor: TERM_BG,
                      minHeight: 0,
                      overflow: "hidden",
                    }}>
                      {/* CRT scanline bar */}
                      {/* Messages */}
                      <div className="term-dotgrid term-chat-area" style={{
                        flex: 1, overflowY: "auto", padding: "10px 14px",
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
                              backdropFilter: "blur(6px)",
                              WebkitBackdropFilter: "blur(6px)",
                              border: `1px solid ${info.color}30`,
                              display: "flex", alignItems: "center", gap: 6,
                              fontSize: 12, fontFamily: "monospace",
                            }}>
                              <span>{info.icon}</span>
                              <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>{phase}</span>
                              <span style={{ color: "#7a6858" }}>{info.hint}</span>
                            </div>
                          );
                        })()}

                        {agentState.messages.length === 0 && (
                          <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 13 }}>
                            {isTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                          </div>
                        )}

                        {agentState.messages.map((msg) => (
                          <MessageBubble key={msg.id} msg={msg} agentName={agentState?.name} onPreview={setPreviewUrl} isTeamLead={agentState?.isTeamLead} isTeamMember={isTeamMember} teamPhase={agentState?.isTeamLead ? getAgentPhase(agent.agentId) : null} />
                        ))}


                        {agentState.pendingApproval && (
                          <div style={{
                            marginBottom: 8, padding: 12,
                            backgroundColor: "#261a00",
                            border: "1px solid #e89030",
                          }}>
                            <div style={{ fontSize: 12, fontWeight: "bold", color: "#e89030", marginBottom: 6, fontFamily: "monospace" }}>
                              {"\u25B2"} {agentState.pendingApproval.title}
                            </div>
                            <div style={{ fontSize: 13, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                              {agentState.pendingApproval.summary}
                            </div>
                            {isOwner && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  className="term-btn"
                                  onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                                  style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                                >{"\u25B6"} Approve</button>
                                <button
                                  className="term-btn"
                                  onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                                  style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                                >{"\u2715"} Reject</button>
                              </div>
                            )}
                          </div>
                        )}


                        {busy && !agentState.pendingApproval && agentState.messages.length > 0 && agentState.messages[agentState.messages.length - 1]?.text && (
                          <div style={{ padding: "4px 0" }}>
                            <span style={{ color: TERM_GREEN, opacity: 0.5 }} className="working-dots"><span className="working-dots-mid" /></span>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      {/* Suggestion feed (visible to owner and collaborator) */}
                      {!isSpectator && suggestions.length > 0 && (
                        <div style={{
                          padding: "6px 10px", borderTop: "1px solid #152515",
                          backgroundColor: "#0a0e0a", maxHeight: 120, overflowY: "auto",
                        }}>
                          <div style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
                          {suggestions.slice(-10).map((s, i) => (
                            <div key={i} style={{ fontSize: 12, color: "#c084fc", marginBottom: 2, lineHeight: 1.4 }}>
                              <span style={{ color: "#7c3aed", fontWeight: 600 }}>{s.author}:</span> {s.text}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pending image previews */}
                      {pendingImages.length > 0 && (
                        <div style={{
                          padding: "6px 10px", borderTop: "1px solid #152515",
                          backgroundColor: "#0a0e0a", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
                        }}>
                          {pendingImages.map((img, i) => (
                            <div key={i} style={{ position: "relative", display: "inline-block" }}>
                              <img src={img.dataUrl} alt={img.name} style={{ height: 48, borderRadius: 4, border: "1px solid #1a2a1a" }} />
                              <button
                                onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                                style={{
                                  position: "absolute", top: -4, right: -4,
                                  width: 16, height: 16, borderRadius: "50%",
                                  border: "none", backgroundColor: "#e04848", color: "#fff",
                                  fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                                  padding: 0, lineHeight: 1,
                                }}
                              >{"\u00d7"}</button>
                            </div>
                          ))}
                          <span style={{ fontSize: 10, color: "#7a6858", fontFamily: "monospace" }}>
                            {pendingImages.length} image{pendingImages.length > 1 ? "s" : ""} attached
                          </span>
                        </div>
                      )}

                      {/* Input / Cancel */}
                      {(() => {
                        const cardPhase = agentState?.isTeamLead ? getAgentPhase(agent.agentId) : null;

                        // Spectator: read-only footer
                        if (isSpectator) {
                          return (
                            <div style={{
                              padding: "8px 10px", borderTop: "1px solid #152515",
                              backgroundColor: "#182844", flexShrink: 0,
                              fontSize: 12, color: "#7ab8f5", fontFamily: "monospace", textAlign: "center",
                            }}>
                              Watching — read-only mode
                            </div>
                          );
                        }

                        // Collaborator: suggest input only
                        if (isCollaborator) {
                          return (
                            <div style={{
                              padding: "8px 10px", borderTop: "1px solid #152515",
                              background: "rgba(10,14,10,0.8)",
                              backdropFilter: "blur(8px)",
                              WebkitBackdropFilter: "blur(8px)",
                              flexShrink: 0,
                            }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  value={suggestText}
                                  onChange={(e) => setSuggestText(e.target.value)}
                                  onKeyDown={(e) => isRealEnter(e) && handleSuggest()}
                                  placeholder="Share an idea..."
                                  maxLength={500}
                                  style={{
                                    flex: 1, padding: "9px 12px", border: "1px solid #7c3aed40",
                                    backgroundColor: "#16122a", color: "#c084fc", fontSize: 14, outline: "none",
                                  }}
                                />
                                <button
                                  onClick={handleSuggest}
                                  disabled={!suggestText.trim()}
                                  style={{
                                    padding: "9px 14px", border: "none",
                                    backgroundColor: suggestText.trim() ? "#a855f7" : "#0e1a0e",
                                    color: suggestText.trim() ? "#fff" : "#5a4838",
                                    fontSize: 13, cursor: suggestText.trim() ? "pointer" : "default",
                                    fontWeight: 700, fontFamily: "monospace",
                                  }}
                                >Suggest</button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div style={{
                            padding: "8px 12px",
                            borderTop: `1px solid ${TERM_GREEN}10`,
                            background: "rgba(6,10,6,0.85)",
                            backdropFilter: "blur(16px)",
                            WebkitBackdropFilter: "blur(16px)",
                            boxShadow: `0 -1px 8px rgba(0,0,0,0.2), inset 0 1px 0 ${TERM_GREEN}06`,
                            flexShrink: 0,
                          }}>
                            {isTeamMember ? (
                              <div style={{
                                textAlign: "center", color: "#5a4838", fontSize: 12, padding: "8px 0", fontFamily: "monospace",
                              }}>
                                Tasks are assigned by the Team Lead
                              </div>
                            ) : cardPhase === "execute" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                <div style={{ display: "flex", gap: 0, alignItems: "center", borderTop: "none" }}>
                                  <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: busy ? "none" : TERM_GLOW }}>&gt;</span>
                                  <input
                                    className="term-input"
                                    value={prompt}
                                    onPaste={handlePasteText}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape" && busy) { handleCancel(); return; }
                                      if (isRealEnter(e)) handleRunTask();
                                    }}
                                    placeholder={busy ? "esc stop · type to continue" : ""}
                                    style={{
                                      flex: 1, padding: "6px 5px", border: "none",
                                      backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                                      fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                                    }}
                                  />
                                                                  </div>
                                {!busy && (
                                  <span
                                    onClick={async () => { if (await confirm("End project?")) handleEndProject(); }}
                                    style={{ padding: "2px 8px 4px", color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: TERM_FONT }}
                                  >close project</span>
                                )}
                              </div>
                            ) : cardPhase === "design" && !busy ? (
                              <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "none", padding: "4px 8px" }}>
                                <button
                                  className="term-btn"
                                  onClick={handleApprovePlan}
                                  style={{
                                    padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                                    backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                                    fontFamily: TERM_FONT,
                                  }}
                                >approve</button>
                                <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
                                <input
                                  className="term-input"
                                  value={prompt}
                                  onPaste={handlePasteText}
                                  onChange={(e) => setPrompt(e.target.value)}
                                  onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                                  placeholder="or give feedback..."
                                  style={{
                                    flex: 1, padding: "5px 6px", border: "none",
                                    backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                                    fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                                  }}
                                />
                              </div>
                            ) : cardPhase === "complete" && !busy ? (
                              <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "none", padding: "4px 8px" }}>
                                <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
                                <input
                                  className="term-input"
                                  value={prompt}
                                  onPaste={handlePasteText}
                                  onChange={(e) => setPrompt(e.target.value)}
                                  onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                                  placeholder="request changes..."
                                  style={{
                                    flex: 1, padding: "5px 6px", border: "none",
                                    backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                                    fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                                  }}
                                />
                                <button
                                  onClick={async () => { if (await confirm("End project?")) handleEndProject(); }}
                                  style={{
                                    padding: "5px 14px", border: "1px solid #e8903040",
                                    backgroundColor: "transparent", color: "#e89030", fontSize: TERM_SIZE, cursor: "pointer",
                                    fontFamily: TERM_FONT, flexShrink: 0,
                                  }}
                                >Close Project</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 0, alignItems: "center", borderTop: "none" }}>
                                <span style={{ color: isAgentBusy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: isAgentBusy ? "none" : TERM_GLOW }}>&gt;</span>
                                <input
                                  className="term-input"
                                  value={prompt}
                                  onPaste={handlePasteText}
                                  onChange={(e) => setPrompt(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape" && isAgentBusy) { handleCancel(); return; }
                                    if (isRealEnter(e)) handleRunTask();
                                  }}
                                  placeholder={isAgentBusy ? "esc stop · type to continue" : ""}
                                  style={{
                                    flex: 1, padding: "6px 5px", border: "none",
                                    backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                                    fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                                  }}
                                  autoFocus
                                />
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

            // Get the active agent list based on current tab
            const activeAgentList = expandedSection === "agents" ? soloAgents
              : expandedSection === "team" ? teamAgents
              : externalAgents;

            // Auto-select first agent if none selected or selected is not in current tab
            const selectedInTab = activeAgentList.some((a) => a.agentId === selectedAgent);

            return (<>

            {/* -- Horizontal Agent Bar -- */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", minHeight: 56,
              borderBottom: `1px solid ${TERM_GREEN}10`,
              background: "rgba(6,10,6,0.85)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(24,255,98,0.06), 0 1px 0 ${TERM_GREEN}08`,
              overflowX: "auto", overflowY: "hidden",
              scrollbarWidth: "none",
            }}>
              {activeAgentList.length === 0 && expandedSection === "external" && (
                <div style={{ padding: "12px 10px", color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>
                  No external agents detected
                </div>
              )}
              {activeAgentList.map((agent, idx) => {
                const isActive = selectedAgent === agent.agentId;
                const agentState = agents.get(agent.agentId);
                const agentBusy = agentState?.status === "working";
                const isLead = !!agentState?.isTeamLead;
                return (
                  <button
                    key={agent.agentId}
                    onClick={() => { setSelectedAgent(agent.agentId); setChatOpen(true); }}
                    title={`${agent.name}\n${agent.role}\n${(STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle).label}`}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      padding: "6px 10px 4px", gap: 2,
                      border: "none", cursor: "pointer",
                      backgroundColor: isActive ? `${TERM_GREEN}08` : "transparent",
                      borderBottom: isActive ? `2px solid ${TERM_GREEN}60` : "2px solid transparent",
                      borderRadius: "4px 4px 0 0",
                      flexShrink: 0, position: "relative",
                      transition: "all 0.15s",
                      boxShadow: isActive ? `0 2px 8px ${TERM_GREEN}15, inset 0 -4px 8px ${TERM_GREEN}08` : "none",
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = `${TERM_GREEN}05`; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ position: "relative", width: 28, height: 34, overflow: "hidden", borderRadius: 2 }}>
                      <div style={{ marginTop: -1, marginLeft: 0 }}>
                        <SpriteAvatar palette={agent.palette ?? 0} zoom={1.75} ready={assetsReady} />
                      </div>
                      {agentBusy && (
                        <span style={{
                          position: "absolute", top: 0, right: 0,
                          width: 6, height: 6, borderRadius: "50%",
                          backgroundColor: TERM_GREEN, boxShadow: `0 0 4px ${TERM_GREEN}`,
                          animation: "px-pulse-gold 1.5s ease infinite",
                        }} />
                      )}
                      {isLead && (
                        <span style={{ position: "absolute", top: -2, left: -1, fontSize: 8, color: "#e89030" }}>{"\u2605"}</span>
                      )}
                    </div>
                    <span style={{
                      fontSize: 9, color: isActive ? "#eddcb8" : "#7a6858",
                      fontFamily: TERM_FONT, maxWidth: 48,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{agent.name}</span>
                  </button>
                );
              })}
              {/* Hire button inline with agents */}
              {/* Hire button inline with agents */}
              {isOwner && expandedSection === "agents" && (
                <button onClick={() => setShowHireModal(true)} title="Hire Agent"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 40, height: "80%", flexShrink: 0,
                    border: "1px dashed #e8b04050", cursor: "pointer",
                    backgroundColor: "transparent", color: "#e8b040",
                    fontSize: 16, fontFamily: TERM_FONT,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#e8b04015"; e.currentTarget.style.borderColor = "#e8b040"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e8b04050"; }}
                >+</button>
              )}
              {/* Team: hire when no team, stop/fire when team exists */}
              {isOwner && expandedSection === "team" && !hasTeam && (
                <button onClick={() => setShowHireTeamModal(true)} title="Hire Team"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 40, height: "80%", flexShrink: 0,
                    border: "1px dashed #e8903050", cursor: "pointer",
                    backgroundColor: "transparent", color: "#e89030",
                    fontSize: 16, fontFamily: TERM_FONT,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#e8903015"; e.currentTarget.style.borderColor = "#e89030"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e8903050"; }}
                >+</button>
              )}
              {isOwner && expandedSection === "team" && hasTeam && teamBusy && (
                <button onClick={handleStopTeam} title="Stop Team Work"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, padding: "0 10px", height: "80%",
                    border: "1px solid #e8903060", cursor: "pointer",
                    backgroundColor: "#e8903015", color: "#e89030",
                    fontSize: 10, fontFamily: TERM_FONT,
                  }}
                >stop</button>
              )}
              {isOwner && expandedSection === "team" && hasTeam && (
                <button onClick={handleFireTeam} title="Fire Team"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, padding: "0 10px", height: "80%",
                    border: "1px solid #e0484830", cursor: "pointer",
                    backgroundColor: "transparent", color: "#c04040",
                    fontSize: 10, fontFamily: TERM_FONT,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#e0484815"; e.currentTarget.style.borderColor = "#e04848"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#e0484830"; }}
                >fire</button>
              )}
            </div>

            {/* -- Chat for selected agent (replaces accordion) -- */}
            {/* Auto-select first agent if none selected in current tab */}
            {!selectedInTab && activeAgentList.length > 0 && (() => {
              const first = activeAgentList[0];
              setTimeout(() => { setSelectedAgent(first.agentId); setChatOpen(true); }, 0);
              return null;
            })()}
            {selectedAgent && selectedInTab ? (
              <div key={consoleMode ? "console" : "sidebar"} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                {renderAgentRow(activeAgentList.find((a) => a.agentId === selectedAgent)!)}
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a3a", fontFamily: TERM_FONT, fontSize: TERM_SIZE }}>
                {activeAgentList.length > 0 ? "Select an agent" : ""}
              </div>
            )}

            {/* Team Activity log */}
            {expandedSection === "team" && teamMessages.length > 0 && (
              <TeamActivityLog messages={teamMessages} agents={agents} assetsReady={assetsReady} onClear={clearTeamMessages} />
            )}

            </>);
          })()}

          </div>
        </div>
      </>}

      {/* ── Mobile: bottom agent bar ── */}
      {isMobile && agentList.length > 0 && !isChatExpanded && !mobileTeamOpen && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          background: "linear-gradient(to top, rgba(22,18,42,0.95) 0%, rgba(22,18,42,0.7) 80%, transparent 100%)",
          overflowX: "auto",
        }}>
          {/* Hire button (owner only) */}
          {isOwner && (
            <button
              onClick={() => setShowHireModal(true)}
              style={{
                width: 44, height: 44, flexShrink: 0,
                border: "1px solid #e8b04060", backgroundColor: "rgba(200,155,48,0.12)",
                color: "#e8b040", fontSize: 22, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >+</button>
          )}
          {/* Team button */}
          <button
            onClick={() => setMobileTeamOpen(true)}
            style={{
              width: 44, height: 44, flexShrink: 0,
              border: "1px solid #e8903070", backgroundColor: "rgba(224,133,48,0.12)",
              color: "#e89030", fontSize: 11, fontWeight: 700, cursor: "pointer",
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
                  border: selectedAgent === agent.agentId ? "1px solid #e8b040" : "1px solid #1a2a1a",
                  backgroundColor: TERM_PANEL,
                  cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <SpriteAvatar palette={agent.palette ?? 0} zoom={1} ready={assetsReady} />
                <span style={{
                  position: "absolute", bottom: 2, right: 2,
                  width: 6, height: 6,
                  backgroundColor: cfg.color, border: "1px solid #0c1210",
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
            backgroundColor: "#0a0e0a",
            display: "flex", flexDirection: "column",
          }}>
            {/* Header */}
            <div
              onClick={() => setChatOpen(false)}
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid #152515",
                display: "flex", alignItems: "center", gap: 10,
                flexShrink: 0,
                backgroundColor: TERM_PANEL,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 15, color: "#7a6858", marginRight: 4 }}>&larr;</span>
              <SpriteAvatar palette={agentState.palette ?? 0} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#eddcb8", display: "flex", alignItems: "center", gap: 4 }}>
                  {agentState.name}
                  {agentState.isTeamLead && (
                    <span style={{ fontSize: 9, padding: "1px 4px", backgroundColor: "#e8903028", color: "#e89030", border: "1px solid #e8903060", fontFamily: "monospace" }}>LEAD</span>
                  )}
                  {mobileIsTeamMember && (
                    <span style={{ fontSize: 9, padding: "1px 4px", backgroundColor: "#e8b04020", color: "#e8b040", border: "1px solid #e8b04050", fontFamily: "monospace" }}>TEAM</span>
                  )}
                  {agentState.tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={agentState.tokenUsage.inputTokens} outputTokens={agentState.tokenUsage.outputTokens} />}
                </div>
                <div style={{ fontSize: 11, color: "#7a6858" }}>{agentState.role}</div>
              </div>
              <span style={{
                fontSize: 10, padding: "2px 6px",
                backgroundColor: cfg.color + "18", color: cfg.color,
                border: `1px solid ${cfg.color}40`,
                flexShrink: 0, fontFamily: "monospace",
              }}>
                {cfg.label}
              </span>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "8px 10px",
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
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
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
                <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 13, fontFamily: "monospace" }}>
                  {mobileIsTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
                </div>
              )}

              {agentState.messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} agentName={agentState.name} onPreview={setPreviewUrl} isTeamLead={agentState.isTeamLead} isTeamMember={mobileIsTeamMember} teamPhase={agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null} />
              ))}


              {agentState.pendingApproval && (
                <div style={{
                  marginBottom: 8, padding: 12,
                  backgroundColor: "#261a00", border: "1px solid #e89030",
                }}>
                  <div style={{ fontSize: 12, fontWeight: "bold", color: "#e89030", marginBottom: 6, fontFamily: "monospace" }}>
                    ▲ {agentState.pendingApproval.title}
                  </div>
                  <div style={{ fontSize: 13, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                    {agentState.pendingApproval.summary}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >▶ Approve</button>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >✕ Reject</button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Suggestion feed (mobile) */}
            {!isSpectator && suggestions.length > 0 && (
              <div style={{
                padding: "6px 10px", borderTop: "1px solid #152515",
                backgroundColor: "#0a0e0a", maxHeight: 80, overflowY: "auto",
              }}>
                <div style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
                {suggestions.slice(-5).map((s, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#c084fc", marginBottom: 2, lineHeight: 1.3 }}>
                    <span style={{ color: "#7c3aed", fontWeight: 600 }}>{s.author}:</span> {s.text}
                  </div>
                ))}
              </div>
            )}

            {/* Input / Cancel */}
            {(() => {
              const mobilePhase = agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null;

              // Spectator: read-only footer
              if (isSpectator) {
                return (
                  <div style={{
                    padding: "8px 10px", borderTop: "1px solid #152515",
                    backgroundColor: "#182844", flexShrink: 0,
                    fontSize: 12, color: "#7ab8f5", fontFamily: "monospace", textAlign: "center",
                  }}>
                    Watching — read-only mode
                  </div>
                );
              }

              // Collaborator: suggest input only
              if (isCollaborator) {
                return (
                  <div style={{
                    padding: "8px 10px", borderTop: "1px solid #152515",
                    backgroundColor: TERM_SURFACE, flexShrink: 0,
                  }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={suggestText}
                        onChange={(e) => setSuggestText(e.target.value)}
                        onKeyDown={(e) => isRealEnter(e) && handleSuggest()}
                        placeholder="Share an idea..."
                        maxLength={500}
                        style={{
                          flex: 1, padding: "9px 12px", border: "1px solid #7c3aed40",
                          backgroundColor: "#16122a", color: "#c084fc", fontSize: 14, outline: "none",
                        }}
                      />
                      <button
                        onClick={handleSuggest}
                        disabled={!suggestText.trim()}
                        style={{
                          padding: "9px 14px", border: "none",
                          backgroundColor: suggestText.trim() ? "#a855f7" : "#0e1a0e",
                          color: suggestText.trim() ? "#fff" : "#5a4838",
                          fontSize: 13, cursor: suggestText.trim() ? "pointer" : "default",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Suggest</button>
                    </div>
                  </div>
                );
              }

              return (
                <div style={{
                  padding: "8px 10px", borderTop: "1px solid #152515",
                  backgroundColor: TERM_SURFACE, flexShrink: 0,
                }}>
                  {mobileIsTeamMember ? (
                    <div style={{
                      textAlign: "center", color: "#5a4838", fontSize: 12, padding: "8px 0", fontFamily: "monospace",
                    }}>
                      Tasks are assigned by the Team Lead
                    </div>
                  ) : mobilePhase === "execute" && busy ? (
                    <button
                      onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                      style={{
                        width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                        backgroundColor: "#3e1818", color: "#e04848", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
                      }}
                    >✕ Cancel current work</button>
                  ) : mobilePhase === "execute" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Send a message..."
                          style={{
                            flex: 1, padding: "9px 12px", border: "1px solid #1a2a1a",
                            backgroundColor: "#16122a", color: "#eddcb8", fontSize: 14, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? "#e8b040" : "#0e1a0e",
                            color: (prompt.trim() || pendingImages.length > 0) ? "#16122a" : "#5a4838",
                            fontSize: 13, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                            fontWeight: 700, fontFamily: "monospace",
                          }}
                        >Send</button>
                      </div>
                      <button
                        onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                        style={{
                          width: "100%", padding: "9px 16px", border: "1px solid #e89030",
                          backgroundColor: "#261a00", color: "#e89030", fontSize: 13, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Close Project</button>
                    </div>
                  ) : mobilePhase === "design" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={handleApprovePlan}
                        style={{
                          width: "100%", padding: "9px 16px", border: "1px solid #48cc6a",
                          backgroundColor: "#143a14", color: "#48cc6a", fontSize: 13, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >▶ Approve Plan</button>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Or give feedback..."
                          style={{
                            flex: 1, padding: "9px 12px", border: "1px solid #1a2a1a",
                            backgroundColor: "#16122a", color: "#eddcb8", fontSize: 14, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? "#e8b040" : "#0e1a0e",
                            color: (prompt.trim() || pendingImages.length > 0) ? "#16122a" : "#5a4838",
                            fontSize: 13, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
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
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Request changes..."
                          style={{
                            flex: 1, padding: "9px 12px", border: "1px solid #1a2a1a",
                            backgroundColor: "#16122a", color: "#eddcb8", fontSize: 14, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? "#e8b040" : "#0e1a0e",
                            color: (prompt.trim() || pendingImages.length > 0) ? "#16122a" : "#5a4838",
                            fontSize: 13, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                            fontWeight: 700, fontFamily: "monospace",
                          }}
                        >Send</button>
                      </div>
                      <button
                        onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                        style={{
                          width: "100%", padding: "9px 16px", border: "1px solid #e89030",
                          backgroundColor: "#261a00", color: "#e89030", fontSize: 13, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Close Project</button>
                    </div>
                  ) : busy ? (
                    <button
                      onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                      style={{
                        width: "100%", padding: "9px 16px", border: "1px solid #e04848",
                        backgroundColor: "#3e1818", color: "#e04848", fontSize: 13, cursor: "pointer", fontFamily: "monospace",
                      }}
                    >✕ Cancel current work</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={prompt}
                        onPaste={handlePasteText}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                        placeholder="Send a message..."
                        style={{
                          flex: 1, padding: "9px 12px", border: "1px solid #1a2a1a",
                          backgroundColor: "#16122a", color: "#eddcb8", fontSize: 14, outline: "none",
                        }}
                        autoFocus
                      />
                      <button
                        onClick={handleRunTask}
                        disabled={!prompt.trim() && pendingImages.length === 0}
                        style={{
                          padding: "9px 14px", border: "none",
                          backgroundColor: (prompt.trim() || pendingImages.length > 0) ? "#e8b040" : "#0e1a0e",
                          color: (prompt.trim() || pendingImages.length > 0) ? "#16122a" : "#5a4838",
                          fontSize: 13, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
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
          backgroundColor: "#0a0e0a",
          display: "flex", flexDirection: "column",
        }}>
          <div
            onClick={() => setMobileTeamOpen(false)}
            style={{
              padding: "12px 14px", borderBottom: "1px solid #152515",
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
              backgroundColor: TERM_PANEL, cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 15, color: "#7a6858", marginRight: 4 }}>&larr;</span>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#eddcb8" }}>Team Chat</div>
            <span style={{ fontSize: 11, color: "#7a6858", fontFamily: "monospace" }}>{teamMessages.length} messages</span>
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
          onImportRoomZip={handleImportRoomZip}
          soundEnabled={soundEnabled}
          onSoundEnabledChange={setSoundEnabled}
        />
      )}

      <OfficeSwitcher
        isOpen={showOfficeSwitcher}
        onClose={() => setShowOfficeSwitcher(false)}
        onSelect={(layout, backgroundImage) => {
          setAssetsReady(false);
          handleImportRoomZip(layout, backgroundImage);
          try { const id = localStorage.getItem('office-selected-id'); if (id) setCurrentOfficeId(id); } catch {}
          // Brief delay so the loading overlay shows the walking animation
          setTimeout(() => setAssetsReady(true), 800);
        }}
        currentOfficeId={currentOfficeId}
      />

      <ProjectHistory
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onPreview={(preview, ratings) => {
          const url = computePreviewUrl(preview);
          if (url) setPreviewUrl(url);
          if (ratings && Object.keys(ratings).length > 0) {
            setPreviewRatings(ratings as Ratings);
            setPreviewRated(true);
          }
        }}
      />

      {previewUrl && (
        <PreviewOverlay
          url={previewUrl}
          savedRatings={previewRatings}
          submitted={previewRated}
          onRate={(r) => {
            setPreviewRatings(r as Ratings);
            setPreviewRated(true);
            sendCommand({ type: "RATE_PROJECT", ratings: r });
          }}
          onClose={() => setPreviewUrl(null)}
        />
      )}

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
      {/* Share link modal */}
      {shareUrl && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShareUrl(null)}>
          <div style={{
            backgroundColor: TERM_PANEL, border: "1px solid #1a2a1a",
            padding: 24, maxWidth: 420, width: "90%",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#eddcb8", marginBottom: 12 }}>Share Link Created</div>
            <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 8 }}>Link copied to clipboard!</div>
            <input
              readOnly
              value={shareUrl}
              style={{
                width: "100%", padding: "8px 10px", border: "1px solid #1a2a1a",
                backgroundColor: "#16122a", color: "#eddcb8", fontSize: 12,
                fontFamily: "monospace", outline: "none",
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              onClick={() => setShareUrl(null)}
              style={{
                marginTop: 12, padding: "8px 20px", border: "none",
                backgroundColor: "#e8b040", color: "#16122a", fontSize: 13,
                cursor: "pointer", fontWeight: 700, fontFamily: "monospace",
              }}
            >OK</button>
          </div>
        </div>
      )}

      {confirmModal}

      {/* Demo mode button */}
      {showDemoButton && !demoRunning && (
        <button
          onClick={() => {
            setDemoRunning(true);
            runDemoScript(() => setDemoRunning(false));
          }}
          style={{
            position: "fixed", bottom: 16, left: 16, zIndex: 50,
            background: "rgba(232, 176, 64, 0.15)", border: "1px solid rgba(232, 176, 64, 0.4)",
            color: "#e8b040", padding: "6px 14px", cursor: "pointer",
            fontSize: 11, fontFamily: "monospace", fontWeight: 600,
          }}
        >
          Run Demo
        </button>
      )}
    </div>
  );
}
