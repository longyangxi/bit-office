import { useRef, useEffect, useLayoutEffect, memo } from "react";
import { getStatusConfig, BACKEND_OPTIONS } from "./office-constants";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_GLOW, TERM_BG, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_BLUE, TERM_SEM_PURPLE, TERM_SEM_CYAN } from "./termTheme";
import { isRealEnter } from "./office-utils";
import { SysMsg, TokenBadge } from "./MessageBubble";
import type { ChatMessage } from "@/store/office-store";
import dynamic from "next/dynamic";

const MessageBubble = dynamic(() => import("./MessageBubble"), { ssr: false });

/** Auto-resize a textarea to fit content (1-row min, maxRows cap) */
function autoResize(el: HTMLTextAreaElement | null, maxRows = 5) {
  if (!el) return;
  el.style.height = "auto";
  const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
  const maxHeight = lineHeight * maxRows;
  el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

/** Sentinel that triggers loadMore when scrolled into view */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [onLoadMore]);
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
  onApplyReviewFixes?: () => void;
  onDismissReview?: () => void;
  /** When true, all scroll management is frozen (e.g. during CSS width transition) */
  scrollFrozen?: boolean;
}

function getPhaseInfo(): Record<string, { color: string; icon: string; hint: string }> {
  return {
    create: { color: TERM_SEM_BLUE, icon: "\uD83D\uDCAC", hint: "Chat with your team lead to define the project" },
    design: { color: TERM_SEM_YELLOW, icon: "\uD83D\uDCCB", hint: "Review the plan \u2014 approve it or give feedback" },
    execute: { color: TERM_SEM_YELLOW, icon: "\u26A1", hint: "Team is building your project" },
    complete: { color: TERM_SEM_GREEN, icon: "\u2713", hint: "Review results \u2014 give feedback or end project" },
  };
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
    scrollFrozen,
  } = props;

  const statusConfig = getStatusConfig();
  const cfg = statusConfig[status] ?? statusConfig.idle;

  // ── Scroll management ──
  // Root cause of blank-screen bugs: the old programmaticScrollRef flag was a
  // single-use boolean consumed by the first scroll event. In 3-pane flex layouts,
  // cross-pane layout reflows fire spurious scroll events that consume the flag
  // before the intended event arrives. The second event then reads stale dimensions,
  // incorrectly sets wasAtBottomRef=false, and all future auto-scroll stops.
  //
  // Fix: remove the flag entirely. scrollToBottom always marks wasAtBottom=true
  // (that's the intent). The scroll handler debounces its position check to the
  // next frame so layout is fully settled before reading dimensions.
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const resizingRef = useRef(false);
  const scrollCheckRafRef = useRef(0);
  const msgCount = messages.length;

  /** Scroll container to bottom. Always marks wasAtBottomRef=true (caller intent).
   *  Uses scrollTop=scrollHeight — browser auto-clamps to valid range. */
  const scrollToBottom = (container: HTMLElement) => {
    container.scrollTop = container.scrollHeight;
    wasAtBottomRef.current = true;
  };

  // When prompt clears (user submitted), force next auto-scroll
  const prevPromptRef = useRef(prompt);
  useEffect(() => {
    if (prevPromptRef.current && !prompt) {
      wasAtBottomRef.current = true;
    }
    prevPromptRef.current = prompt;
  }, [prompt]);

  // When scrollFrozen transitions true→false (transition ended), force scroll to bottom.
  const prevFrozenRef = useRef(scrollFrozen);
  useEffect(() => {
    const wasFrozen = prevFrozenRef.current;
    prevFrozenRef.current = scrollFrozen;
    if (wasFrozen && !scrollFrozen) {
      const el = chatEndRef.current;
      const container = el?.parentElement;
      if (container) {
        wasAtBottomRef.current = true;
        requestAnimationFrame(() => scrollToBottom(container));
      }
    }
  }, [scrollFrozen]);

  // Track scroll position via scroll events.
  // Debounced to next frame so we only read dimensions after layout settles —
  // prevents false negatives from stale scrollHeight during flex reflows.
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const onScroll = () => {
      if (resizingRef.current || scrollFrozen) return;
      cancelAnimationFrame(scrollCheckRafRef.current);
      scrollCheckRafRef.current = requestAnimationFrame(() => {
        wasAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(scrollCheckRafRef.current);
    };
  }, [agentId, scrollFrozen]);

  // Keep scroll pinned to bottom when container resizes (e.g. textarea grow/shrink).
  // Single rAF is now safe because scrollToBottom always sets wasAtBottom=true,
  // so even if the first attempt uses slightly stale dimensions, subsequent
  // MutationObserver/useLayoutEffect calls will correct it.
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (scrollFrozen) return;
      resizingRef.current = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (wasAtBottomRef.current) {
          scrollToBottom(container);
        }
        resizingRef.current = false;
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      resizingRef.current = false;
    };
  }, [agentId, scrollFrozen]);

  // Scroll to bottom synchronously after DOM commit when messages change
  useLayoutEffect(() => {
    if (scrollFrozen) return;
    const el = chatEndRef.current;
    const container = el?.parentElement;
    if (container && wasAtBottomRef.current) {
      scrollToBottom(container);
    }
  }, [agentId, msgCount, scrollFrozen]);

  // MutationObserver for streaming text updates
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (scrollFrozen) return;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (wasAtBottomRef.current) {
            scrollToBottom(container);
          }
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [agentId, scrollFrozen]);

  // Reset textarea height when prompt is cleared (e.g. after sending a message)
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!prompt && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [prompt]);

  // ── Reviewer overlay scroll management ──
  const reviewChatEndRef = useRef<HTMLDivElement>(null);
  const reviewWasAtBottomRef = useRef(true);
  const reviewMsgCount = reviewerOverlay?.messages.length ?? 0;

  useEffect(() => {
    const el = reviewChatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const onScroll = () => {
      reviewWasAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [reviewerOverlay?.agentId]);

  useLayoutEffect(() => {
    const el = reviewChatEndRef.current;
    const container = el?.parentElement;
    if (container && reviewWasAtBottomRef.current) {
      scrollToBottom(container);
    }
  }, [reviewerOverlay?.agentId, reviewMsgCount]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
      position: "relative",
    }}>
      {/* ── Info bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 14px",
        background: TERM_PANEL,
        borderBottom: `1px solid ${TERM_BORDER_DIM}`,
        fontSize: 12, fontFamily: TERM_FONT,
        flexShrink: 0,
      }}>
        <span style={{ color: TERM_SEM_CYAN, fontWeight: 600, flexShrink: 0, fontSize: 12 }}>
          {role?.split("\u2014")[0]?.trim()}
          {backend && <span style={{ color: TERM_DIM, fontSize: 11 }}> ({BACKEND_OPTIONS.find((b) => b.id === backend)?.name ?? backend})</span>}
        </span>
        {(cwd || workDir) && (
          <span className="term-path-scroll" style={{ fontSize: 11, color: TERM_DIM, flexShrink: 1, minWidth: 0 }} title={cwd ?? workDir ?? undefined}>
            {cwd ?? workDir}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: cfg.color, fontSize: 11, flexShrink: 0, fontWeight: 500 }}>{cfg.label}</span>
        {tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={tokenUsage.inputTokens} outputTokens={tokenUsage.outputTokens} />}
        {!teamId && isOwner && (
          <span
            onClick={(e) => { e.stopPropagation(); onFire(agentId); }}
            style={{
              fontSize: 12, color: TERM_SEM_RED, cursor: "pointer", lineHeight: 1,
              padding: "4px", flexShrink: 0, opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
          >{"\u2715"}</span>
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
            boxShadow: `0 1px 0 ${TERM_BORDER_DIM}`,
            background: TERM_PANEL,
            flexShrink: 0,
          }}>
            <div style={{ fontSize: TERM_SIZE, color: TERM_GREEN, opacity: 0.6, marginBottom: 4, fontFamily: TERM_FONT, letterSpacing: "0.05em" }}>
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
          <div className="crt-screen" style={{
            flex: 1, overflowY: "auto", padding: "8px 10px",
            display: "flex", flexDirection: "column",
            minHeight: 0,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: TERM_DIM, padding: 20, fontSize: 13 }}>
                Waiting for output...
              </div>
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

      {/* ── Review overlay — floats on top of this agent's pane ── */}
      {reviewerOverlay && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 20,
          display: "flex", flexDirection: "column",
          backgroundColor: TERM_BG,
          animation: "review-overlay-in 0.3s ease-out",
          borderLeft: `2px solid ${TERM_SEM_PURPLE}40`,
          borderRight: `2px solid ${TERM_SEM_PURPLE}40`,
        }}>
          {/* Reviewer info bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px",
            background: TERM_PANEL,
            borderBottom: `1px solid ${TERM_SEM_PURPLE}30`,
            fontSize: 12, fontFamily: TERM_FONT,
            flexShrink: 0,
          }}>
            <span style={{
              display: "inline-block", padding: "2px 8px",
              backgroundColor: `${TERM_SEM_PURPLE}18`, color: TERM_SEM_PURPLE,
              fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              border: `1px solid ${TERM_SEM_PURPLE}40`,
            }}>
              {reviewerOverlay.busy ? "REVIEWING..." : "REVIEW COMPLETE"}
            </span>
            <span style={{ color: TERM_SEM_PURPLE, fontWeight: 600, fontSize: 12 }}>
              {reviewerOverlay.name}
            </span>
            <span style={{ color: TERM_DIM, fontSize: 11 }}>
              {reviewerOverlay.role?.split("\u2014")[0]?.trim()}
            </span>
            <span style={{ flex: 1 }} />
            {reviewerOverlay.tokenUsage.inputTokens > 0 && (
              <TokenBadge inputTokens={reviewerOverlay.tokenUsage.inputTokens} outputTokens={reviewerOverlay.tokenUsage.outputTokens} />
            )}
          </div>

          {/* Reviewer messages */}
          <div className="crt-screen term-dotgrid term-chat-area" style={{
            flex: 1, overflowY: "auto", padding: "10px 14px",
            display: "flex", flexDirection: "column",
            minHeight: 0, backgroundColor: TERM_BG,
          }}>
            {reviewerOverlay.visibleMessages.length === 0 && (
              <div style={{ textAlign: "center", color: TERM_SEM_PURPLE, padding: 20, fontSize: 13, opacity: 0.6 }}>
                Starting review...
              </div>
            )}
            {reviewerOverlay.hasMoreMessages && onReviewerLoadMore && (
              <LoadMoreSentinel onLoadMore={onReviewerLoadMore} />
            )}
            {reviewerOverlay.visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentName={reviewerOverlay.name} />
            ))}
            {reviewerOverlay.busy && reviewerOverlay.visibleMessages.length > 0 && reviewerOverlay.visibleMessages[reviewerOverlay.visibleMessages.length - 1]?.text && (
              <div style={{ padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: TERM_SEM_PURPLE, opacity: 0.5 }} className="working-dots"><span className="working-dots-mid" /></span>
                {reviewerOverlay.lastLogLine && (
                  <span style={{ color: TERM_DIM, fontSize: 10, fontFamily: TERM_FONT, opacity: 0.6 }}>
                    {reviewerOverlay.lastLogLine.slice(0, 60)}
                  </span>
                )}
              </div>
            )}
            <div ref={reviewChatEndRef} />
          </div>

          {/* Reviewer footer — status or action buttons */}
          <div style={{
            padding: "8px 12px",
            background: TERM_PANEL,
            borderTop: `1px solid ${TERM_SEM_PURPLE}30`,
            fontSize: 11, color: TERM_SEM_PURPLE, fontFamily: TERM_FONT,
            flexShrink: 0,
          }}>
            {!reviewerOverlay.busy ? (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {onApplyReviewFixes && (
                  <button
                    onClick={onApplyReviewFixes}
                    style={{
                      padding: "6px 18px", border: `1px solid ${TERM_SEM_GREEN}60`,
                      backgroundColor: `${TERM_SEM_GREEN}10`, color: TERM_SEM_GREEN,
                      fontSize: 12, fontWeight: 600, fontFamily: TERM_FONT,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_GREEN}20`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_GREEN}10`; }}
                  >Apply Fixes</button>
                )}
                {onDismissReview && (
                  <button
                    onClick={onDismissReview}
                    style={{
                      padding: "6px 18px", border: `1px solid ${TERM_SEM_PURPLE}40`,
                      backgroundColor: "transparent", color: TERM_SEM_PURPLE,
                      fontSize: 12, fontWeight: 600, fontFamily: TERM_FONT,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_PURPLE}10`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >Dismiss</button>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>Reviewing code changes...</div>
            )}
          </div>
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
          <div className="term-dotgrid term-chat-area" style={{
            flex: 1, overflowY: "auto", padding: "10px 14px",
            display: "flex", flexDirection: "column",
            minHeight: 0,
          }}>
            {/* Phase banner for team leads */}
            {isTeamLead && (() => {
              if (!teamPhase) return null;
              const info = getPhaseInfo()[teamPhase];
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
                  <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>{teamPhase}</span>
                  <span style={{ color: TERM_DIM }}>{info.hint}</span>
                </div>
              );
            })()}

            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: TERM_DIM, padding: 20, fontSize: 13 }}>
                {isTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
              </div>
            )}

            {hasMoreMessages && <LoadMoreSentinel onLoadMore={onLoadMore} />}
            {visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentName={name} onPreview={onPreview} onReview={onReview} isTeamLead={isTeamLead} isTeamMember={isTeamMember} teamPhase={isTeamLead ? teamPhase : null} detectedBackends={detectedBackends} />
            ))}

            {pendingApproval && (
              <div style={{
                marginBottom: 8, padding: 12,
                backgroundColor: TERM_SURFACE,
                border: `1px solid ${TERM_SEM_YELLOW}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: TERM_SEM_YELLOW, marginBottom: 6, fontFamily: "monospace" }}>
                  {"\u25B2"} {pendingApproval.title}
                </div>
                <div style={{ fontSize: 13, color: TERM_TEXT, marginBottom: 10, lineHeight: 1.5 }}>
                  {pendingApproval.summary}
                </div>
                {isOwner && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="term-btn"
                      onClick={() => onApproval(pendingApproval.approvalId, "yes")}
                      style={{ flex: 1, padding: "8px", border: `1px solid ${TERM_SEM_GREEN}`, backgroundColor: TERM_PANEL, color: TERM_SEM_GREEN, cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >{"\u25B6"} Approve</button>
                    <button
                      className="term-btn"
                      onClick={() => onApproval(pendingApproval.approvalId, "no")}
                      style={{ flex: 1, padding: "8px", border: `1px solid ${TERM_SEM_RED}`, backgroundColor: TERM_PANEL, color: TERM_SEM_RED, cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >{"\u2715"} Reject</button>
                  </div>
                )}
              </div>
            )}

            {busy && !pendingApproval && messages.length > 0 && messages[messages.length - 1]?.text && (
              <div style={{ padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: TERM_GREEN, opacity: 0.5 }} className="working-dots"><span className="working-dots-mid" /></span>
                {lastLogLine && (
                  <span style={{ color: TERM_DIM, fontSize: 10, fontFamily: TERM_FONT, opacity: 0.6 }}>
                    {lastLogLine.slice(0, 60)}
                  </span>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Suggestion feed (visible to owner and collaborator) */}
          {!isSpectator && suggestions.length > 0 && (
            <div style={{
              padding: "6px 10px", borderTop: `1px solid ${TERM_BORDER_DIM}`,
              backgroundColor: TERM_BG, maxHeight: 120, overflowY: "auto",
            }}>
              <div style={{ fontSize: 10, color: TERM_SEM_PURPLE, fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
              {suggestions.slice(-10).map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: TERM_TEXT, marginBottom: 2, lineHeight: 1.4 }}>
                  <span style={{ color: TERM_SEM_PURPLE, fontWeight: 600 }}>{s.author}:</span> {s.text}
                </div>
              ))}
            </div>
          )}

          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div style={{
              padding: "6px 10px", borderTop: `1px solid ${TERM_BORDER_DIM}`,
              backgroundColor: TERM_BG, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
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
              <span style={{ fontSize: 10, color: TERM_DIM, fontFamily: "monospace" }}>
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
                  padding: "8px 10px", borderTop: `1px solid ${TERM_BORDER_DIM}`,
                  backgroundColor: TERM_SURFACE, flexShrink: 0,
                  fontSize: 12, color: TERM_SEM_BLUE, fontFamily: "monospace", textAlign: "center",
                }}>
                  Watching — read-only mode
                </div>
              );
            }

            // Collaborator: suggest input only
            if (isCollaborator) {
              return (
                <div style={{
                  padding: "8px 10px", borderTop: `1px solid ${TERM_BORDER_DIM}`,
                  background: TERM_PANEL,
                  flexShrink: 0,
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
                        flex: 1, padding: "9px 12px", border: `1px solid ${TERM_SEM_PURPLE}40`,
                        backgroundColor: TERM_BG, color: TERM_SEM_PURPLE, fontSize: 14, outline: "none",
                        resize: "none", lineHeight: "20px", fontFamily: "inherit",
                      }}
                    />
                    <button
                      onClick={onSuggest}
                      disabled={!suggestText.trim()}
                      style={{
                        padding: "9px 14px", border: "none",
                        backgroundColor: suggestText.trim() ? TERM_SEM_PURPLE : TERM_SURFACE,
                        color: suggestText.trim() ? "#fff" : TERM_DIM,
                        fontSize: 13, cursor: suggestText.trim() ? "pointer" : "default",
                        fontWeight: 700, fontFamily: "monospace",
                      }}
                    >Suggest</button>
                  </div>
                </div>
              );
            }

            // Owner input area
            return (
              <div style={{
                padding: "8px 12px",
                borderTop: `1px solid ${TERM_BORDER_DIM}`,
                background: TERM_PANEL,
                flexShrink: 0,
              }}>
                {isTeamMember ? (
                  <div style={{
                    textAlign: "center", color: TERM_DIM, fontSize: 12, padding: "8px 0", fontFamily: "monospace",
                  }}>
                    Tasks are assigned by the Team Lead
                  </div>
                ) : cardPhase === "execute" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div style={{ display: "flex", gap: 0, alignItems: "flex-end", borderTop: "none" }}>
                      <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: busy ? "none" : TERM_GLOW }}>&gt;</span>
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
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end", borderTop: "none", padding: "4px 8px" }}>
                    <button
                      className="term-btn"
                      onClick={onApprovePlan}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT,
                      }}
                    >approve</button>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
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
                ) : cardPhase === "complete" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end", borderTop: "none", padding: "4px 8px" }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
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
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end", borderTop: "none", padding: "4px 8px" }}>
                    <button
                      className="term-btn"
                      onClick={onQuickApprove}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT,
                      }}
                    >approve</button>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
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
                ) : (
                  <div style={{ display: "flex", gap: 0, alignItems: "flex-end", borderTop: "none" }}>
                    <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: busy ? "none" : TERM_GLOW }}>&gt;</span>
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
