"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendCommand } from "@/lib/connection";
import type { ChatMessage } from "@/store/office-store";
import { TERM_FONT, TERM_SIZE, TERM_ACCENT, TERM_DIM, TERM_TEXT, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_GREEN, TERM_PANEL, TERM_ERROR } from "./termTheme";
import { linkifyText, formatDuration, formatTokenCount, computePreviewUrl, hasWebPreview, buildPreviewCommand } from "./office-utils";
import { DiffHighlightedCode } from "./DiffHighlightedCode";
import { ReviewButton } from "./ReviewButton";
import { previewBtnStyle } from "./messageBubbleStyles";

function ThinkingBubble({ logLine }: { logLine: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{
        padding: "6px 12px",
        backgroundColor: TERM_PANEL, color: TERM_DIM, fontSize: TERM_SIZE,
        fontFamily: TERM_FONT,
        borderLeft: `2px solid ${TERM_BORDER_DIM}`,
        maxWidth: "100%", overflow: "hidden",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        opacity: 0.8,
      }}>
        <span style={{ marginRight: 6, opacity: 0.5 }}>{">"}</span>
        {logLine || "Thinking..."}
      </div>
    </div>
  );
}

function TokenBadge({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }: {
  inputTokens: number; outputTokens: number;
  cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number;
}) {
  if (inputTokens === 0 && outputTokens === 0) return null;
  const titleParts = [`Input: ${inputTokens.toLocaleString()}`, `Output: ${outputTokens.toLocaleString()}`];
  if (cacheReadTokens) titleParts.push(`Cache read: ${cacheReadTokens.toLocaleString()}`);
  if (cacheWriteTokens) titleParts.push(`Cache write: ${cacheWriteTokens.toLocaleString()}`);
  if (costUsd) titleParts.push(`Cost: $${costUsd.toFixed(4)}`);
  const costStr = costUsd != null && costUsd > 0
    ? ` $${costUsd >= 1 ? costUsd.toFixed(2) : costUsd.toFixed(4)}`
    : "";
  return (
    <span style={{
      fontSize: TERM_SIZE, padding: "1px 4px",
      color: TERM_DIM, fontFamily: TERM_FONT,
      whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums",
    }} title={titleParts.join(" / ")}>
      {"\u2191"}{formatTokenCount(inputTokens)} {"\u2193"}{formatTokenCount(outputTokens)}{costStr}
    </span>
  );
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
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
    const lang = className?.replace("language-", "") ?? "";
    const isBlock = className?.includes("language-") || text.includes("\n");
    const isDiff = lang === "diff";
    const openMatch = text.match(/^open\s+(\/\S+)/);
    const fileMatch = !openMatch ? text.match(/^(\/[\w./-]+\.\w+)$/) : null;
    const filePath = openMatch?.[1] ?? fileMatch?.[1];
    if (filePath) {
      return (
        <pre
          onClick={() => sendCommand({ type: "OPEN_FILE", path: filePath })}
          style={{
            padding: "8px 10px",
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}
          title="Click to open"
        >
          <code {...props}>{text}</code>
        </pre>
      );
    }
    if (isBlock) {
      return (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", position: "relative" }}>
          {lang && (
            <span style={{
              position: "absolute", top: -1, right: 6,
              fontSize: TERM_SIZE, color: TERM_DIM,
              fontFamily: "inherit", letterSpacing: "0.04em",
              userSelect: "none", pointerEvents: "none",
            }}>{lang}</span>
          )}
          <code {...props}>
            {isDiff ? <DiffHighlightedCode text={text} /> : children}
          </code>
        </pre>
      );
    }
    return <code {...props}>{children}</code>;
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

const MdContent = memo(function MdContent({ text }: { text: string }) {
  return (
    <ReactMarkdown urlTransform={(url) => url} remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)')}
    </ReactMarkdown>
  );
});

export function SysMsg({ ts, tag, text, firstLine, isLong, isError }: { ts: string; tag: string; text: string; firstLine: string; isLong: boolean; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textColor = isError ? TERM_ERROR : TERM_DIM;
  return (
    <div className="term-msg" style={{ marginBottom: 2, fontSize: TERM_SIZE, fontFamily: TERM_FONT, lineHeight: 1.7, color: TERM_DIM, padding: "1px 0" }}>
      <span className="term-ts" style={{ color: TERM_DIM, marginRight: 6 }}>{ts}</span>
      {isLong && (
        <span
          onClick={() => setExpanded(!expanded)}
          style={{ color: isError ? TERM_ERROR : TERM_DIM, cursor: "pointer", marginRight: 4 }}
        >{expanded ? "\u25BE" : "\u25B8"}</span>
      )}
      <span style={{ color: isError ? TERM_ERROR : TERM_DIM, marginRight: 6 }}>{tag}</span>
      <span style={{ color: textColor, wordBreak: "break-word" }} className="chat-markdown">
        {isLong && !expanded
          ? <span>{firstLine}</span>
          : <MdContent text={text} />
        }
      </span>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({ msg, agentName, onPreview, onReview, isTeamLead, isTeamMember, teamPhase, detectedBackends }: { msg: ChatMessage; agentName?: string; onPreview?: (url: string) => void; onReview?: (result: NonNullable<ChatMessage["result"]>, backend?: string) => void; isTeamLead?: boolean; isTeamMember?: boolean; teamPhase?: string | null; detectedBackends?: string[] }) {
  const ts = new Date(msg.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base: React.CSSProperties = { marginBottom: 4, fontSize: TERM_SIZE, fontFamily: TERM_FONT, lineHeight: 1.7 };

  // ── User input ──
  if (msg.role === "user") {
    const isFromTeam = msg.text.startsWith("[From ");
    if (isFromTeam && msg.text.length > 80) {
      return <SysMsg ts={ts} tag="task" text={msg.text} firstLine={msg.text.slice(0, 80) + "..."} isLong={true} />;
    }
    return (
      <div className="term-msg" style={{
        ...base, marginTop: 12, marginBottom: 8,
        borderLeft: `2px solid ${TERM_BORDER}`,
        padding: "6px 12px",
      }}>
        <span className="term-ts" style={{ color: TERM_DIM, marginRight: 6 }}>{ts}</span>
        <span style={{ color: TERM_DIM }}>&gt; </span>
        <span style={{ color: TERM_TEXT, wordBreak: "break-word" }}>{linkifyText(msg.text)}</span>
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
  const isStreaming = msg.id.endsWith("-stream") && !msg.result;
  const hasFullOutput = !!(msg.result?.fullOutput && msg.result.fullOutput !== msg.text && msg.result.fullOutput.length > msg.text.length + 20);
  const planMatch = msg.text.match(/\[PLAN\]([\s\S]*?)\[\/PLAN\]/i);
  const planContent = planMatch?.[1]?.trim();
  const textWithoutPlan = planContent ? msg.text.replace(/\[PLAN\][\s\S]*?\[\/PLAN\]/i, "").trim() : null;
  const displayText = hasFullOutput ? (msg.result?.fullOutput ?? msg.text) : msg.text;

  // Streaming message
  if (isStreaming) {
    if (!msg.text) {
      return (
        <div style={{ ...base, padding: "2px 0" }}>
          <span className="term-ts" style={{ color: TERM_DIM, marginRight: 6 }}>{ts}</span>
          <span style={{ color: TERM_DIM }}>{agentName ?? "agent"}</span>
          <span style={{ color: TERM_DIM, marginLeft: 8 }} className="working-dots"><span className="working-dots-mid" /></span>
        </div>
      );
    }
    return (
      <div style={{ ...base, padding: "2px 0" }}>
        <span className="term-ts" style={{ color: TERM_DIM, marginRight: 6 }}>{ts}</span>
        <span style={{ color: TERM_DIM }}>{agentName ?? "agent"}</span>
        <div style={{ marginTop: 2, color: TERM_TEXT, wordBreak: "break-word" }} className="chat-markdown">
          <MdContent text={msg.text} />
        </div>
      </div>
    );
  }

  // Completion (team lead final result)
  if (isTeamLead && msg.isFinalResult && msg.result) {
    const r = msg.result;
    const cleanSummary = r.summary.replace(/ENTRY_FILE:\s*.+/gi, "").replace(/PROJECT_DIR:\s*.+/gi, "").replace(/SUMMARY:\s*/gi, "").trim();
    const entryFile = r.entryFile ?? r.summary.match(/ENTRY_FILE:\s*(.+)/i)?.[1]?.trim();
    const projectDir = r.projectDir ?? r.summary.match(/PROJECT_DIR:\s*(.+)/i)?.[1]?.trim();
    const changedFiles = r.changedFiles ?? [];
    return (
      <div className="term-msg" style={{ ...base, marginTop: 10, borderTop: `1px solid ${TERM_BORDER_DIM}`, paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="term-ts" style={{ color: TERM_DIM }}>{ts}</span>
          <span style={{ color: TERM_SEM_GREEN }}>done</span>
          {msg.durationMs && msg.durationMs > 1000 && (
            <span style={{ color: TERM_DIM, fontFamily: TERM_FONT }}>{formatDuration(msg.durationMs)}</span>
          )}
        </div>
        <div style={{ color: TERM_TEXT, wordBreak: "break-word" }} className="chat-markdown"><MdContent text={cleanSummary || "completed."} /></div>
        {(projectDir || entryFile) && (
          <div style={{ color: TERM_DIM, marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
            {projectDir && <span className="term-path-scroll">{projectDir}</span>}
            {entryFile && <span onClick={() => sendCommand({ type: "OPEN_FILE", path: entryFile })} style={{ cursor: "pointer", color: TERM_TEXT, textDecoration: "underline", textDecorationColor: TERM_DIM, textUnderlineOffset: "2px" }}>{entryFile}</span>}
          </div>
        )}
        {changedFiles.length > 0 && <div style={{ color: TERM_DIM, marginTop: 2 }}>{changedFiles.length} files changed</div>}
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {hasWebPreview(r) && onPreview && <button className="term-btn" onClick={() => { const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); const url = computePreviewUrl(r); if (url) onPreview(url); }} style={previewBtnStyle}>preview</button>}
          {!hasWebPreview(r) && buildPreviewCommand(r) && <button className="term-btn" onClick={() => { const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); }} style={previewBtnStyle}>launch</button>}
        </div>
      </div>
    );
  }

  // ── Regular agent message ──
  return (
    <div className="term-msg" style={{ ...base, paddingTop: 8, marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="term-ts" style={{ color: TERM_DIM }}>{ts}</span>
        <span style={{ color: TERM_DIM }}>{agentName ?? "agent"}</span>
      </div>
      <div style={{ color: TERM_TEXT, wordBreak: "break-word" }} className="chat-markdown">
        {planContent ? (
          <>
            {textWithoutPlan && <div className="chat-markdown"><MdContent text={textWithoutPlan} /></div>}
            <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${TERM_BORDER}` }}>
              <div style={{ color: TERM_DIM, marginBottom: 4, letterSpacing: "0.04em" }}>PLAN</div>
              <div className="chat-markdown"><MdContent text={planContent!} /></div>
            </div>
          </>
        ) : (
          <MdContent text={displayText} />
        )}
        {msg.result && msg.result.changedFiles.length > 0 && !planContent && (
          <div style={{ color: TERM_DIM, marginTop: 4 }}>{msg.result.changedFiles.length} files: {msg.result.changedFiles.slice(0, 3).join(", ")}{msg.result.changedFiles.length > 3 ? ` +${msg.result.changedFiles.length - 3}` : ""}</div>
        )}
        {msg.result && !isTeamMember && !isTeamLead && (hasWebPreview(msg.result) || (onReview && msg.result.changedFiles.length > 0)) && (
          <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
            {hasWebPreview(msg.result) && onPreview && (
              <button className="term-btn" onClick={() => { const r = msg.result!; const cmd = buildPreviewCommand(r); if (cmd) sendCommand(cmd); const url = computePreviewUrl(r); if (url) onPreview(url); }} style={previewBtnStyle}>preview</button>
            )}
            {onReview && msg.result.changedFiles.length > 0 && (
              <ReviewButton result={msg.result} onReview={onReview} detectedBackends={detectedBackends ?? []} />
            )}
          </div>
        )}
        {msg.durationMs && msg.durationMs > 1000 && (
          <div style={{ color: TERM_DIM, marginTop: 4, fontFamily: TERM_FONT }}>
            {formatDuration(msg.durationMs)}
          </div>
        )}
      </div>
    </div>
  );
});

export { TokenBadge, MdContent, ThinkingBubble };
export default MessageBubble;
