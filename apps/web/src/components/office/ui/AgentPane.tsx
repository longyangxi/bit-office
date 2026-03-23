import { useRef, useEffect, memo, useCallback, useState } from "react";
import { useScrollAnchor } from "./useScrollAnchor";
import { getStatusConfig, BACKEND_OPTIONS } from "./office-constants";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_BG, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_BLUE, TERM_SEM_PURPLE, TERM_SEM_CYAN } from "./termTheme";
import { isRealEnter } from "./office-utils";
import { SysMsg, TokenBadge } from "./MessageBubble";
import { TermButton, TermInput, TermEmpty } from "./primitives";
import type { ChatMessage } from "@/store/office-store";
import dynamic from "next/dynamic";

const MessageBubble = dynamic(() => import("./MessageBubble"), { ssr: false });

/** Auto-resize a textarea to fit content (1-row min, maxRows cap).
 *  Works consistently across Chrome (Blink) and Tauri/Safari (WebKit). */
function autoResize(el: HTMLTextAreaElement | null, maxRows = 5) {
  if (!el) return;
  const cs = getComputedStyle(el);
  const lineHeight = parseInt(cs.lineHeight) || 20;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const maxHeight = lineHeight * maxRows;

  // Collapse to 0 so scrollHeight reports the minimum needed height.
  // Using "0" instead of "auto" avoids WebKit quirks where "auto" keeps
  // the rows-based default height, inflating scrollHeight.
  el.style.height = "0";
  const sh = el.scrollHeight; // always content + padding (never border)

  // For content-box (textarea default): height = content only → subtract padding
  // For border-box (e.g. Tailwind reset): height = content + padding + border
  const isBorderBox = cs.boxSizing === "border-box";
  const contentH = isBorderBox ? sh + borderY : sh - padY;

  // Clamp: ensure at least 1 lineHeight of content
  const minH = isBorderBox ? lineHeight + padY + borderY : lineHeight;
  const h = Math.max(minH, Math.min(contentH, maxHeight + (isBorderBox ? padY + borderY : 0)));

  el.style.height = h + "px";
  // Decide overflow from unclamped content height, not the clamped `h`
  const rawContentH = isBorderBox ? contentH - padY - borderY : contentH;
  el.style.overflowY = rawContentH > maxHeight ? "auto" : "hidden";
}

/** Sentinel that triggers loadMore when scrolled into view */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Use the nearest scrollable ancestor as root so the observer detects
    // visibility within the scroll container, not the viewport.
    // Viewport-rooted observers can miss intersection changes inside nested
    // overflow:auto containers (especially WebKit / Tauri).
    const scrollRoot = el.closest<HTMLElement>("[data-scrollbar]") ?? el.parentElement;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) cbRef.current();
    }, { threshold: 0, root: scrollRoot, rootMargin: "100px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ height: 1, flexShrink: 0 }} />;
}

/** Data needed to render a reviewer overlay on top of an agent pane */
export interface ReviewerOverlayData {
  agentId: string;
  name: string;
  role?: string;
  backend?: string;
  status: string;
  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  hasMoreMessages: boolean;
  tokenUsage: { inputTokens: number; outputTokens: number };
  lastLogLine: string | null;
  busy: boolean;
  /** Set when review is complete — null means still working */
  reviewDone: boolean;
}

export interface AgentPaneProps {
  agentId: string;
  name: string;
  role?: string;
  backend?: string;
  status: string;
  cwd?: string | null;
  workDir?: string | null;
  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  hasMoreMessages: boolean;
  tokenUsage: { inputTokens: number; outputTokens: number };
  isTeamLead?: boolean;
  isTeamMember: boolean;
  isExternal: boolean;
  teamId?: string;
  teamPhase: string | null;
  pendingApproval: { approvalId: string; title: string; summary: string } | null;
  awaitingApproval?: boolean;
  lastLogLine: string | null;
  busy: boolean;
  pid?: number | null;
  // User role
  isOwner: boolean;
  isCollaborator: boolean;
  isSpectator: boolean;
  // Input state
  prompt: string;
  onPromptChange: (val: string) => void;
  pendingImages: { name: string; dataUrl: string; base64: string }[];
  onPendingImagesChange: (imgs: { name: string; dataUrl: string; base64: string }[]) => void;
  suggestions: { text: string; author: string; timestamp: number }[];
  suggestText: string;
  onSuggestTextChange: (val: string) => void;
  // Callbacks
  onSubmit: () => void;
  onCancel: () => void;
  onFire: (agentId: string) => void;
  onApproval: (approvalId: string, decision: "yes" | "no") => void;
  onApprovePlan: () => void;
  onEndProject: () => void;
  onSuggest: () => void;
  onPreview: (url: string) => void;
  onLoadMore: () => void;
  onPasteImage: (e: React.ClipboardEvent) => void;
  onPasteText: (e: React.ClipboardEvent<HTMLElement>) => void;
  onDropImage: (e: React.DragEvent) => void;
  onQuickApprove?: () => void;
  onReview?: (result: { changedFiles: string[]; projectDir?: string; entryFile?: string; summary: string }, backend?: string) => void;
  detectedBackends?: string[];
  // Review overlay — reviewer pane rendered on top of this agent
  reviewerOverlay?: ReviewerOverlayData | null;
  onReviewerLoadMore?: () => void;
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
  /** When true, all scroll management is frozen (e.g. during CSS width transition) */
  scrollFrozen?: boolean;
  /** Hide role/backend in info bar (shown in console header instead) */
  hideInfoRole?: boolean;
}

/** Memoized message list — decoupled from input state so typing doesn't re-render messages */
const ChatMessageList = memo(function ChatMessageList({
  visibleMessages, hasMoreMessages, messages, name, agentId,
  onPreview, onReview, isTeamLead, isTeamMember, teamPhase,
  detectedBackends, onLoadMore, busy, pendingApproval, lastLogLine,
  chatEndRef, isOwner, onApproval,
}: {
  visibleMessages: ChatMessage[];
  hasMoreMessages: boolean;
  messages: ChatMessage[];
  name: string;
  agentId: string;
  onPreview?: (url: string) => void;
  onReview?: (result: any, backend?: string) => void;
  isTeamLead?: boolean;
  isTeamMember: boolean;
  teamPhase: string | null;
  detectedBackends?: string[];
  onLoadMore: () => void;
  busy: boolean;
  pendingApproval: { approvalId: string; title: string; summary: string } | null;
  lastLogLine: string | null;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  isOwner: boolean;
  onApproval: (approvalId: string, decision: "yes" | "no") => void;
}) {
  return (
    <>
      {/* Phase banner for team leads */}
      {isTeamLead && (() => {
        if (!teamPhase) return null;
        const info = getPhaseInfo()[teamPhase];
        if (!info) return null;
        return (
          <div style={{
            padding: "6px 10px", marginBottom: 8,
            borderLeft: `2px solid ${TERM_DIM}`,
            display: "flex", alignItems: "center", gap: 6,
            fontSize: TERM_SIZE, fontFamily: TERM_FONT,
          }}>
            <span style={{ color: TERM_DIM, textTransform: "uppercase", letterSpacing: "0.05em" }}>{teamPhase}</span>
            <span style={{ color: TERM_DIM }}>{info.hint}</span>
          </div>
        );
      })()}

      {messages.length === 0 && (
        <TermEmpty
          message={isTeamMember ? "managed by Team Lead" : "no messages yet"}
          hint={isTeamMember ? undefined : "send a message to get started"}
        />
      )}

      {hasMoreMessages && <LoadMoreSentinel onLoadMore={onLoadMore} />}
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} agentName={name} onPreview={onPreview} onReview={onReview} isTeamLead={isTeamLead} isTeamMember={isTeamMember} teamPhase={isTeamLead ? teamPhase : null} detectedBackends={detectedBackends} />
      ))}

      {pendingApproval && (
        <div style={{
          marginBottom: 8, padding: 12,
          borderLeft: `2px solid ${TERM_SEM_YELLOW}`,
          fontSize: TERM_SIZE, fontFamily: TERM_FONT,
        }}>
          <div style={{ color: TERM_SEM_YELLOW, marginBottom: 6 }}>
            {pendingApproval.title}
          </div>
          <div style={{ color: TERM_TEXT, marginBottom: 10, lineHeight: 1.65 }}>
            {pendingApproval.summary}
          </div>
          {isOwner && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="term-btn"
                onClick={() => onApproval(pendingApproval.approvalId, "yes")}
                style={{ flex: 1, padding: "6px", border: `1px solid ${TERM_DIM}`, backgroundColor: "transparent", color: TERM_SEM_GREEN, cursor: "pointer", fontSize: TERM_SIZE, fontFamily: TERM_FONT }}
              >approve</button>
              <button
                className="term-btn"
                onClick={() => onApproval(pendingApproval.approvalId, "no")}
                style={{ flex: 1, padding: "6px", border: `1px solid ${TERM_DIM}`, backgroundColor: "transparent", color: TERM_SEM_RED, cursor: "pointer", fontSize: TERM_SIZE, fontFamily: TERM_FONT }}
              >reject</button>
            </div>
          )}
        </div>
      )}

      {busy && !pendingApproval && messages.length > 0 && messages[messages.length - 1]?.text && (() => {
        const hint = lastLogLine
          || messages[messages.length - 1]?.text?.split("\n").filter(Boolean).pop()?.slice(0, 60)
          || null;
        return (
          <div style={{ padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: TERM_DIM }} className="working-dots"><span className="working-dots-mid" /></span>
            {hint && (
              <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>
                {hint.slice(0, 60)}
              </span>
            )}
          </div>
        );
      })()}
      <div ref={chatEndRef} />
    </>
  );
});

function getPhaseInfo(): Record<string, { color: string; icon: string; hint: string }> {
  return {
    create: { color: TERM_SEM_BLUE, icon: "\uD83D\uDCAC", hint: "Chat with your team lead to define the project" },
    design: { color: TERM_SEM_YELLOW, icon: "\uD83D\uDCCB", hint: "Review the plan \u2014 approve it or give feedback" },
    execute: { color: TERM_SEM_YELLOW, icon: "\u26A1", hint: "Team is building your project" },
    complete: { color: TERM_SEM_GREEN, icon: "\u2713", hint: "Review results \u2014 give feedback or end project" },
  };
}

/** Review footer with feedback input + action buttons */
function ReviewFooter({ onApplyReviewFixes, onDismissReview }: {
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus feedback input when review panel appears
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  return (
    <div style={{
      padding: "8px 12px",
      background: TERM_PANEL,
      boxShadow: "0 -3px 6px -2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
      fontFamily: TERM_FONT, flexShrink: 0,
    }}>
      {/* Feedback input */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <TermInput
          ref={inputRef}
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && onApplyReviewFixes) {
              e.preventDefault();
              onApplyReviewFixes(feedback || undefined);
            }
          }}
          placeholder="Add feedback for the fix..."
          style={{ flex: 1 }}
        />
      </div>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {onApplyReviewFixes && (
          <TermButton
            variant="success"
            onClick={() => onApplyReviewFixes(feedback || undefined)}
            style={{ padding: "6px 18px" }}
          >apply fixes</TermButton>
        )}
        {onDismissReview && (
          <TermButton
            variant="dim"
            onClick={onDismissReview}
            style={{ padding: "6px 18px" }}
          >dismiss</TermButton>
        )}
      </div>
    </div>
  );
}

const AgentPane = memo(function AgentPane(props: AgentPaneProps) {
  const {
    agentId, name, role, backend, status, cwd, workDir,
    messages, visibleMessages, hasMoreMessages,
    tokenUsage, isTeamLead, isTeamMember, isExternal, teamId, teamPhase,
    pendingApproval, awaitingApproval, lastLogLine, busy, pid,
    isOwner, isCollaborator, isSpectator,
    prompt, onPromptChange, pendingImages, onPendingImagesChange,
    suggestions, suggestText, onSuggestTextChange,
    onSubmit, onCancel, onFire, onApproval, onApprovePlan, onEndProject,
    onSuggest, onPreview, onLoadMore, onPasteImage, onPasteText, onDropImage,
    onQuickApprove, onReview, detectedBackends,
    reviewerOverlay, onReviewerLoadMore, onApplyReviewFixes, onDismissReview,
    scrollFrozen, hideInfoRole,
  } = props;

  const statusConfig = getStatusConfig();
  const cfg = statusConfig[status] ?? statusConfig.idle;

  // ── Scroll management (unified via useScrollAnchor) ──
  // All scroll-to-bottom logic (new messages, streaming, resize, visibility
  // restore, frozen thaw) is handled by one hook with a single rAF executor.
  // forcePin: when prompt clears after send, re-pin to bottom.
  const prevPromptRef = useRef(prompt);
  const promptJustCleared = prevPromptRef.current !== "" && prompt === "";
  prevPromptRef.current = prompt;

  const chatEndRef = useScrollAnchor({
    msgCount: messages.length,
    frozen: scrollFrozen,
    key: agentId,
    forcePin: promptJustCleared,
  });

  // Reset textarea height when prompt is cleared (e.g. after sending a message)
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!prompt && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [prompt]);

  // ── Scroll-away detection for "new messages" pill ──
  const [scrolledAway, setScrolledAway] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const away = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
        setScrolledAway(away);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [agentId]);
  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" as ScrollBehavior });
    setScrolledAway(false);
  }, [chatEndRef]);

  // ── Reviewer overlay scroll (same hook, separate instance) ──
  const reviewChatEndRef = useScrollAnchor({
    msgCount: reviewerOverlay?.messages.length ?? 0,
    frozen: false,
    key: reviewerOverlay?.agentId ?? "",
  });

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
      position: "relative",
    }}>
      {/* ── Info bar ── */}
      <div className={`term-info-bar ${status === "working" ? "ap-status-working" : status === "waiting_approval" ? "ap-status-waiting" : status === "done" ? "ap-status-done" : status === "error" ? "ap-status-error" : "ap-status-idle"}`} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "5px 14px",
        background: TERM_PANEL,
        fontSize: 12, fontFamily: TERM_FONT,
        flexShrink: 0,
      }}>
        {!hideInfoRole && (
          <span style={{ color: TERM_TEXT_BRIGHT, flexShrink: 0, letterSpacing: "-0.01em" }}>
            {role?.split("\u2014")[0]?.trim()}
          </span>
        )}
        {(cwd || workDir) && (
          <span className="term-path-scroll" style={{
            color: TERM_TEXT, flexShrink: 1, minWidth: 0, opacity: 0.6,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            direction: "rtl", textAlign: "left",
          }} title={cwd ?? workDir ?? ""}>
            <bdi>{cwd ?? workDir}</bdi>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: TERM_TEXT_BRIGHT, flexShrink: 0, opacity: 0.5 }}>{cfg.label}</span>
        {tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={tokenUsage.inputTokens} outputTokens={tokenUsage.outputTokens} />}
        {!teamId && isOwner && (
          <button
            className="tdx"
            onClick={(e) => { e.stopPropagation(); onFire(agentId); }}
            aria-label="Fire agent"
          >{"\u2715"}</button>
        )}
      </div>

      {/* ── External agent panel ── */}
      {isExternal && (
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
            boxShadow: `0 3px 6px -2px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)`,
            background: TERM_PANEL,
            flexShrink: 0,
          }}>
            <div style={{ fontSize: TERM_SIZE, color: TERM_DIM, marginBottom: 4, fontFamily: TERM_FONT, letterSpacing: "0.05em" }}>
              EXTERNAL PROCESS
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT, flexWrap: "wrap" }}>
              <span>{backend ?? "unknown"}</span>
              <span>PID {pid ?? "\u2014"}</span>
              <span className="term-path-scroll" title={cwd ?? undefined} style={{ maxWidth: 300 }}>
                {cwd ?? "\u2014"}
              </span>
            </div>
          </div>

          {/* Scrollable messages */}
          <div data-scrollbar className="crt-screen" style={{
            flex: 1, overflowY: "auto", padding: "8px 10px",
            display: "flex", flexDirection: "column",
            minHeight: 0,
          }}>
            {messages.length === 0 && (
              <TermEmpty message="waiting for output" />
            )}
            {hasMoreMessages && <LoadMoreSentinel onLoadMore={onLoadMore} />}
            {visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentName={name} />
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

      {/* ── Review overlay — two-phase: mini input-area overlay (working) → expanded panel (done) ── */}
      {reviewerOverlay && reviewerOverlay.busy && (
        /* Phase 1: Small window covering only the input area — shows role + "..." + streaming thoughts */
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          maxHeight: "40%",
          display: "flex", flexDirection: "column",
          background: TERM_PANEL,
          boxShadow: "0 -4px 12px -2px rgba(0,0,0,0.5)",
          fontFamily: TERM_FONT, fontSize: TERM_SIZE,
          animation: "review-overlay-in 0.3s ease-out",
        }}>
          {/* Header: name + dots + dismiss */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px",
            boxShadow: "0 2px 4px -1px rgba(0,0,0,0.3), inset 0 -1px 0 rgba(0,0,0,0.4)",
            flexShrink: 0,
          }}>
            <span style={{ color: TERM_TEXT_BRIGHT }}>
              {reviewerOverlay.role?.split("\u2014")[0]?.trim() || reviewerOverlay.name}
            </span>
            <span className="working-dots" style={{ color: TERM_DIM }}>
              <span className="working-dots-mid" />
            </span>
            <span style={{ flex: 1 }} />
            {reviewerOverlay.tokenUsage.inputTokens > 0 && (
              <TokenBadge inputTokens={reviewerOverlay.tokenUsage.inputTokens} outputTokens={reviewerOverlay.tokenUsage.outputTokens} />
            )}
            {onDismissReview && (
              <button
                onClick={onDismissReview}
                style={{
                  padding: "2px 8px", border: `1px solid ${TERM_BORDER}`,
                  backgroundColor: "transparent", color: TERM_DIM,
                  fontSize: TERM_SIZE, fontFamily: TERM_FONT,
                  cursor: "pointer", flexShrink: 0, lineHeight: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = TERM_TEXT; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; }}
              >{"\u00d7"}</button>
            )}
          </div>
          {/* Scrollable streaming thoughts — only shown when reviewer has messages */}
          {reviewerOverlay.visibleMessages.length > 0 && (
            <div data-scrollbar style={{
              flex: 1, overflowY: "auto", padding: "8px 12px",
              minHeight: 0, maxHeight: 120,
              backgroundColor: TERM_BG,
            }}>
              {reviewerOverlay.visibleMessages.filter(m => m.role === "agent" && m.text).map((msg) => (
                <div key={msg.id} style={{
                  fontSize: TERM_SIZE, color: TERM_DIM, lineHeight: 1.65,
                  fontFamily: TERM_FONT, marginBottom: 4,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {msg.text.length > 300 ? msg.text.slice(-300) : msg.text}
                </div>
              ))}
              <div ref={reviewChatEndRef} />
            </div>
          )}
          {/* Fallback hint when no messages yet */}
          {reviewerOverlay.visibleMessages.length === 0 && (
            <div style={{
              padding: "8px 12px", color: TERM_DIM, fontSize: TERM_SIZE,
              fontFamily: TERM_FONT,
            }}>
              {reviewerOverlay.lastLogLine?.slice(0, 80) || "Reviewing code changes..."}
            </div>
          )}
        </div>
      )}

      {reviewerOverlay && !reviewerOverlay.busy && (
        /* Phase 2: Expanded result panel — covers bottom 65% of agent pane */
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          height: "65%", minHeight: 200,
          display: "flex", flexDirection: "column",
          backgroundColor: TERM_BG,
          boxShadow: "0 -4px 12px -2px rgba(0,0,0,0.5)",
          animation: "review-slide-up 0.25s ease-out",
        }}>
          {/* Header bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px",
            background: TERM_PANEL,
            boxShadow: "0 3px 6px -2px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
            fontSize: TERM_SIZE, fontFamily: TERM_FONT,
            flexShrink: 0,
          }}>
            <span style={{ color: TERM_SEM_GREEN }}>done</span>
            <span style={{ color: TERM_TEXT_BRIGHT }}>
              {reviewerOverlay.name}
            </span>
            <span style={{ flex: 1 }} />
            {reviewerOverlay.tokenUsage.inputTokens > 0 && (
              <TokenBadge inputTokens={reviewerOverlay.tokenUsage.inputTokens} outputTokens={reviewerOverlay.tokenUsage.outputTokens} />
            )}
          </div>

          {/* Final review result — all agent messages */}
          <div data-scrollbar className="term-dotgrid term-chat-area" style={{
            flex: 1, overflowY: "auto", padding: "10px 14px",
            display: "flex", flexDirection: "column",
            minHeight: 0, backgroundColor: TERM_BG,
          }}>
            {(() => {
              const agentMsgs = reviewerOverlay.visibleMessages.filter(m => m.role === "agent" && m.text);
              return agentMsgs.length > 0 ? (
                agentMsgs.map(msg => (
                  <MessageBubble key={msg.id} msg={msg} agentName={reviewerOverlay.name} />
                ))
              ) : (
                <div style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "10px 0" }}>
                  (No review content)
                </div>
              );
            })()}
            <div ref={reviewChatEndRef} />
          </div>

          {/* Footer: feedback input + action buttons */}
          <ReviewFooter
            onApplyReviewFixes={onApplyReviewFixes}
            onDismissReview={onDismissReview}
          />
        </div>
      )}

      {/* ── Normal agent panel ── */}
      {!isExternal && (
        <div
          onPaste={onPasteImage}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.currentTarget.style.outline = `2px solid ${TERM_SEM_YELLOW}60`; } }}
          onDragLeave={(e) => { e.currentTarget.style.outline = "none"; }}
          onDrop={(e) => { e.currentTarget.style.outline = "none"; onDropImage(e); }}
          className="crt-screen"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: TERM_BG,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Messages */}
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div ref={scrollContainerRef} data-scrollbar className="term-dotgrid term-chat-area" style={{
              flex: 1, overflowY: "auto", padding: "10px 14px",
              display: "flex", flexDirection: "column",
              minHeight: 0,
            }}>
              <ChatMessageList
                visibleMessages={visibleMessages}
                hasMoreMessages={hasMoreMessages}
                messages={messages}
                name={name}
                agentId={agentId}
                onPreview={onPreview}
                onReview={(reviewerOverlay || onDismissReview) ? undefined : onReview}
                isTeamLead={isTeamLead}
                isTeamMember={isTeamMember}
                teamPhase={teamPhase}
                detectedBackends={detectedBackends}
                onLoadMore={onLoadMore}
                busy={busy}
                pendingApproval={pendingApproval}
                lastLogLine={lastLogLine}
                chatEndRef={chatEndRef}
                isOwner={isOwner}
                onApproval={onApproval}
              />
            </div>
            {/* Scroll-to-bottom pill */}
            <div
              className={`scroll-pill${scrolledAway ? " visible" : ""}`}
              onClick={scrollToBottom}
              role="button"
              aria-label="Scroll to bottom"
            >
              <span className="scroll-pill-arrow">{"\u2193"}</span>
              new messages
            </div>
          </div>

          {/* Suggestion feed (visible to owner and collaborator) */}
          {!isSpectator && suggestions.length > 0 && (
            <div data-scrollbar style={{
              padding: "6px 10px",
              backgroundColor: TERM_BG, maxHeight: 120, overflowY: "auto",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 -2px 4px rgba(0,0,0,0.2)",
            }}>
              <div style={{ fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT, marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
              {suggestions.slice(-10).map((s, i) => (
                <div key={i} style={{ fontSize: TERM_SIZE, color: TERM_TEXT, marginBottom: 2, lineHeight: 1.65, fontFamily: TERM_FONT }}>
                  <span style={{ color: TERM_DIM }}>{s.author}:</span> {s.text}
                </div>
              ))}
            </div>
          )}

          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div style={{
              padding: "6px 10px",
              backgroundColor: TERM_BG, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 -2px 4px rgba(0,0,0,0.2)",
            }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position: "relative", display: "inline-block" }}>
                  <img src={img.dataUrl} alt={img.name} style={{ height: 48, borderRadius: 4, border: `1px solid ${TERM_BORDER_DIM}` }} />
                  <button
                    onClick={() => onPendingImagesChange(pendingImages.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: -4, right: -4,
                      width: 16, height: 16, borderRadius: "50%",
                      border: "none", backgroundColor: TERM_SEM_RED, color: "#fff",
                      fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 0, lineHeight: 1,
                    }}
                  >{"\u00d7"}</button>
                </div>
              ))}
              <span style={{ fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT }}>
                {pendingImages.length} image{pendingImages.length > 1 ? "s" : ""} attached
              </span>
            </div>
          )}

          {/* ── Input / Cancel ── */}
          {(() => {
            const cardPhase = isTeamLead ? teamPhase : null;

            // Spectator: read-only footer
            if (isSpectator) {
              return (
                <div style={{
                  padding: "8px 10px",
                  backgroundColor: TERM_SURFACE, flexShrink: 0,
                  fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT, textAlign: "center",
                  boxShadow: "0 -3px 6px -2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
                }}>
                  Watching — read-only mode
                </div>
              );
            }

            // Collaborator: suggest input only
            if (isCollaborator) {
              return (
                <div style={{
                  padding: "8px 10px",
                  background: TERM_PANEL,
                  flexShrink: 0,
                  boxShadow: "0 -3px 6px -2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
                }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <textarea
                      rows={1}
                      value={suggestText}
                      onChange={(e) => { onSuggestTextChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => isRealEnter(e) && (e.preventDefault(), onSuggest())}
                      placeholder="Share an idea..."
                      maxLength={500}
                      style={{
                        flex: 1, padding: "6px 10px", border: `1px solid ${TERM_BORDER}`,
                        backgroundColor: TERM_BG, color: TERM_TEXT, fontSize: TERM_SIZE, outline: "none",
                        resize: "none", lineHeight: "20px", fontFamily: TERM_FONT,
                      }}
                    />
                    <button
                      onClick={onSuggest}
                      disabled={!suggestText.trim()}
                      style={{
                        padding: "6px 14px", border: `1px solid ${TERM_DIM}`,
                        backgroundColor: "transparent",
                        color: suggestText.trim() ? TERM_TEXT : TERM_DIM,
                        fontSize: TERM_SIZE, cursor: suggestText.trim() ? "pointer" : "default",
                        fontFamily: TERM_FONT,
                      }}
                    >suggest</button>
                  </div>
                </div>
              );
            }

            // Owner input area
            return (
              <div className="term-input-area" style={{
                padding: "8px 12px",
                background: TERM_PANEL,
                flexShrink: 0,
              }}>
                {isTeamMember ? (
                  <div style={{
                    textAlign: "center", color: TERM_DIM, fontSize: TERM_SIZE, padding: "8px 0", fontFamily: TERM_FONT,
                  }}>
                    Tasks are assigned by the Team Lead
                  </div>
                ) : cardPhase === "execute" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div className="term-input-well">
                      <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: "none" }}>&gt;</span>
                      <textarea
                        ref={inputRef}
                        rows={1}
                        className="term-input"
                        value={prompt}
                        onPaste={onPasteText}
                        onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape" && busy) { onCancel(); return; }
                          if (isRealEnter(e)) { e.preventDefault(); onSubmit(); }
                        }}
                        placeholder={busy ? "esc stop \u00b7 type to continue" : ""}
                        style={{
                          flex: 1, padding: "6px 5px", border: "none",
                          backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                          fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                          resize: "none", lineHeight: "20px",
                        }}
                      />
                    </div>
                    {!busy && (
                      <span
                        onClick={onEndProject}
                        style={{ padding: "2px 8px 4px", color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: TERM_FONT }}
                      >close project</span>
                    )}
                  </div>
                ) : cardPhase === "design" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    <button
                      className="term-btn"
                      onClick={onApprovePlan}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT, flexShrink: 0,
                      }}
                    >approve</button>
                    <div className="term-input-well" style={{ flex: 1 }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "0 0 0 6px" }}>&gt;</span>
                    <textarea
                      ref={inputRef}
                      rows={1}
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); onSubmit(); } }}
                      placeholder="or give feedback..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                        resize: "none", lineHeight: "20px",
                      }}
                    />
                    </div>
                  </div>
                ) : cardPhase === "complete" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    <div className="term-input-well" style={{ flex: 1 }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "0 0 0 6px" }}>&gt;</span>
                    <textarea
                      ref={inputRef}
                      rows={1}
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); onSubmit(); } }}
                      placeholder="request changes..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                        resize: "none", lineHeight: "20px",
                      }}
                    />
                    </div>
                    <button
                      onClick={onEndProject}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_SEM_YELLOW}40`,
                        backgroundColor: "transparent", color: TERM_SEM_YELLOW, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT, flexShrink: 0,
                      }}
                    >Close Project</button>
                  </div>
                ) : awaitingApproval && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    <button
                      className="term-btn"
                      onClick={onQuickApprove}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT, flexShrink: 0,
                      }}
                    >approve</button>
                    <div className="term-input-well" style={{ flex: 1 }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "0 0 0 6px" }}>&gt;</span>
                    <textarea
                      ref={inputRef}
                      rows={1}
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); onSubmit(); } }}
                      placeholder="or give feedback..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                        resize: "none", lineHeight: "20px",
                      }}
                    />
                    </div>
                  </div>
                ) : (
                  <div className="term-input-well">
                    <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: "none" }}>&gt;</span>
                    <textarea
                      ref={inputRef}
                      rows={1}
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && busy) { onCancel(); return; }
                        if (isRealEnter(e)) { e.preventDefault(); onSubmit(); }
                      }}
                      placeholder={busy ? "esc stop \u00b7 type to continue" : ""}
                      style={{
                        flex: 1, padding: "6px 5px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                        resize: "none", lineHeight: "20px",
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
});

export default AgentPane;
