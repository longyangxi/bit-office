"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendCommand } from "@/lib/connection";
import type { ChatMessage } from "@/store/office-store";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_ERROR, TERM_GLOW, TERM_PANEL } from "./termTheme";
import { linkifyText, formatDuration, formatTokenCount, computePreviewUrl, hasWebPreview, buildPreviewCommand } from "./office-utils";

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

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Use <div> instead of <p> to avoid hydration errors when block elements
  // (like <pre>) appear inside paragraphs — HTML forbids <pre> inside <p>.
  p({ children }) {
    return <div style={{ marginBottom: 8 }}>{children}</div>;
  },
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

function MdContent({ text }: { text: string }) {
  return (
    <ReactMarkdown urlTransform={(url) => url} remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)')}
    </ReactMarkdown>
  );
}

export function SysMsg({ ts, tag, text, firstLine, isLong, isError }: { ts: string; tag: string; text: string; firstLine: string; isLong: boolean; isError?: boolean }) {
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

function MessageBubble({ msg, agentName, onPreview, onReview, isTeamLead, isTeamMember, teamPhase }: { msg: ChatMessage; agentName?: string; onPreview?: (url: string) => void; onReview?: (result: NonNullable<ChatMessage["result"]>) => void; isTeamLead?: boolean; isTeamMember?: boolean; teamPhase?: string | null }) {
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
        {msg.result && !isTeamMember && !isTeamLead && (hasWebPreview(msg.result) || (onReview && msg.result.changedFiles.length > 0)) && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {hasWebPreview(msg.result) && onPreview && (
              <button className="term-btn" onClick={() => { const r = msg.result!; const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); const url = computePreviewUrl(r); if (url) setTimeout(() => onPreview(url), r.previewUrl ? 0 : 1500); }} style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}>preview</button>
            )}
            {onReview && msg.result.changedFiles.length > 0 && (
              <button className="term-btn" onClick={() => onReview(msg.result!)} style={{ ...btnStyle, color: "#c084fc", borderColor: "#c084fc40", backgroundColor: "#c084fc08" }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#c084fc18"; e.currentTarget.style.boxShadow = "0 0 8px #c084fc15"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#c084fc08"; e.currentTarget.style.boxShadow = "none"; }}>review</button>
            )}
          </div>
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

export { TokenBadge };
export default MessageBubble;
