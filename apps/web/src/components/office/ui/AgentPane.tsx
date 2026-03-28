import { useRef, useEffect, memo, useCallback, useState } from "react";
import { useScrollAnchor } from "./useScrollAnchor";
import { getStatusConfig, getPhaseInfo, BACKEND_OPTIONS } from "./office-constants";
import { TERM_FONT, TERM_SIZE, TERM_SIZE_2XS, TERM_SIZE_SM, TERM_ACCENT, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_BG, TERM_PANEL, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED } from "./termTheme";
import { isRealEnter, autoResize } from "./office-utils";
import { TokenBadge } from "./MessageBubble";
import { TermEmpty } from "./primitives";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/store/office-store";
import dynamic from "next/dynamic";
import { LoadMoreSentinel } from "./LoadMoreSentinel";
import { ReviewerOverlay } from "./ReviewerOverlay";

const MessageBubble = dynamic(() => import("./MessageBubble"), { ssr: false });

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
  tokenUsage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number };
  lastLogLine: string | null;
  busy: boolean;
  /** Set when review is complete — null means still working */
  reviewDone: boolean;
  /** The resolved review result text (fallback when messages are empty) */
  reviewResultText?: string | null;
  /** Parsed verdict from reviewer output — PASS means no bugs */
  verdict?: "PASS" | "FAIL" | "UNKNOWN";
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
  tokenUsage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number };
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
  autoMerge?: boolean;
  pendingMerge?: boolean;
  lastMergeCommit?: string | null;
  lastMergeMessage?: string | null;
  undoCount?: number;
  onMerge?: () => void;
  onRevert?: () => void;
  onUndoMerge?: () => void;
  // Review overlay — reviewer pane rendered on top of this agent
  reviewerOverlay?: ReviewerOverlayData | null;
  onReviewerLoadMore?: () => void;
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
  /** When true, all scroll management is frozen (e.g. during CSS width transition) */
  scrollFrozen?: boolean;
  /** Hide role/backend in info bar (shown in console header instead) */
  hideInfoRole?: boolean;
  /** Inline avatar data (console mode) — renders avatar + name inside info bar */
  inlineAvatar?: { name: string; palette: number; isTeamLead: boolean; assetsReady: boolean; AvatarComponent?: React.ComponentType<{ palette: number; zoom?: number; ready?: boolean }> } | null;
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

      {busy && !pendingApproval && messages.length > 0 && (() => {
        const lastMsg = messages[messages.length - 1];
        // When the stream message already shows text, skip the hint text to avoid
        // visual duplicate — but still show the animated dots so the user sees activity.
        const streamHasText = lastMsg?.id?.endsWith("-stream") && !!lastMsg.text;
        const hint = streamHasText ? null
          : (lastLogLine || lastMsg?.text?.split("\n").filter(Boolean).pop()?.slice(0, 60) || null);
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
    autoMerge, pendingMerge, lastMergeCommit, lastMergeMessage, undoCount, onMerge, onRevert, onUndoMerge,
    reviewerOverlay, onReviewerLoadMore, onApplyReviewFixes, onDismissReview,
    scrollFrozen, hideInfoRole, inlineAvatar,
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
    <div className="flex flex-col flex-1 min-h-0 relative">
      {/* ── Info bar (single merged row) ── */}
      {/* boxShadow handled by .term-info-bar + .ap-status-* CSS classes */}
      <div
        className={cn(
          "term-info-bar flex items-center gap-2 px-3 py-2 bg-term-surface font-mono text-term shrink-0",
          status === "working" ? "ap-status-working" : status === "waiting_approval" ? "ap-status-waiting" : status === "done" ? "ap-status-done" : status === "error" ? "ap-status-error" : "ap-status-idle",
        )}
      >
        {/* Drag handle for pane reorder */}
        <span className="mpv-drag-handle" title="Drag to reorder">⠿</span>
        {/* Inline avatar (console mode) */}
        {inlineAvatar && (() => {
          const AvatarComp = inlineAvatar.AvatarComponent;
          const backendName = backend ? (BACKEND_OPTIONS.find((b) => b.id === backend)?.name ?? backend) : null;
          const roleName = role?.split("\u2014")[0]?.trim();
          return (
            <>
              {AvatarComp && (
                <div className="relative w-[24px] h-[28px] overflow-hidden rounded-sm shrink-0" style={{ border: `1px solid ${TERM_BORDER_DIM}` }}>
                  <div className="-mt-px">
                    <AvatarComp palette={inlineAvatar.palette} zoom={1.5} ready={inlineAvatar.assetsReady} />
                  </div>
                </div>
              )}
              <span className="text-term text-term-text-bright font-medium tracking-tight shrink-0">{inlineAvatar.name}</span>
              {inlineAvatar.isTeamLead && (
                <span
                  className="text-term-3xs font-mono font-bold text-sem-yellow px-[3px] leading-[15px] rounded-sm shrink-0"
                  style={{ border: `1px solid ${TERM_SEM_YELLOW}40` }}
                >LEAD</span>
              )}
              {backendName && (
                <span className="text-term-xs text-term-text opacity-60 shrink-0 tracking-wide">
                  {backendName}
                </span>
              )}
              {roleName && (
                <span className="text-term-xs text-term-text opacity-45 shrink-0 tracking-wide hidden sm:inline">
                  {roleName}
                </span>
              )}
            </>
          );
        })()}
        {!hideInfoRole && !inlineAvatar && (
          <span className="text-term-text-bright shrink-0 tracking-tight">
            {role?.split("\u2014")[0]?.trim()}
          </span>
        )}
        {!inlineAvatar && (cwd || workDir) && (() => {
          const raw = cwd ?? workDir ?? "";
          const display = raw.replace(/^\/Users\/[^/]+/, "~");
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="term-path-scroll" style={{
                  color: TERM_TEXT, flexShrink: 1, minWidth: 0, opacity: 0.5,
                  overflow: "hidden", whiteSpace: "nowrap",
                  direction: "rtl", textAlign: "left",
                  fontSize: TERM_SIZE - 1,
                }}>
                  <bdi>{display}</bdi>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs break-all">{raw}</TooltipContent>
            </Tooltip>
          );
        })()}
        <span className="flex-1" />
        {/* Status dot */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 w-[7px] h-[7px] rounded-full"
              style={{
                backgroundColor: cfg.color,
                boxShadow: busy ? `0 0 6px ${cfg.color}60` : "none",
                animation: busy ? "px-pulse-gold 1.5s ease infinite" : "none",
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">{cfg.label}</TooltipContent>
        </Tooltip>
        {tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={tokenUsage.inputTokens} outputTokens={tokenUsage.outputTokens} cacheReadTokens={tokenUsage.cacheReadTokens} cacheWriteTokens={tokenUsage.cacheWriteTokens} costUsd={tokenUsage.costUsd} />}
        {!teamId && isOwner && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="tdx"
                onClick={(e) => { e.stopPropagation(); onFire(agentId); }}
                aria-label="Fire agent"
              >{"\u2715"}</button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fire agent</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* ── Review overlay — unified panel: scanning animation (busy) → results (done) ── */}
      {reviewerOverlay && (
        <ReviewerOverlay
          reviewerOverlay={reviewerOverlay}
          reviewChatEndRef={reviewChatEndRef}
          onApplyReviewFixes={onApplyReviewFixes}
          onDismissReview={onDismissReview}
          onReviewerLoadMore={onReviewerLoadMore}
        />
      )}

      {/* ── Agent panel ── */}
      <div
          onPaste={onPasteImage}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.currentTarget.style.outline = `2px solid ${TERM_SEM_YELLOW}60`; } }}
          onDragLeave={(e) => { e.currentTarget.style.outline = "none"; }}
          onDrop={(e) => { e.currentTarget.style.outline = "none"; onDropImage(e); }}
          className="crt-screen flex-1 flex flex-col bg-background min-h-0 overflow-hidden"
        >
          {/* Messages */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div ref={scrollContainerRef} data-scrollbar className="term-dotgrid term-chat-area flex-1 overflow-y-auto px-3.5 pt-3.5 pb-2.5 flex flex-col min-h-0">
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
            {/* Floating Undo button — bottom-right of scroll area */}
            {!busy && isOwner && !teamId && !isTeamMember && !pendingMerge && (undoCount ?? 0) > 0 && onUndoMerge && (
              <button
                className="term-btn"
                onClick={onUndoMerge}
                style={{
                  position: "absolute", bottom: 8, right: 14,
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 12px",
                  border: "1px solid color-mix(in srgb, var(--term-accent) 55%, transparent)",
                  backgroundColor: "var(--term-bg)",
                  color: "var(--term-accent)",
                  fontSize: TERM_SIZE, cursor: "pointer",
                  fontFamily: TERM_FONT, zIndex: 2, borderRadius: 3, opacity: 0.85,
                }}
              ><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l4-4 4 4"/><path d="M6 2v8a4 4 0 0 0 4 4h2"/></svg>Undo ({undoCount})</button>
            )}
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
                      fontSize: TERM_SIZE_2XS, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
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
                <div className="px-2.5 py-2 bg-muted shrink-0 font-mono text-term text-muted-foreground text-center shadow-[0_-3px_6px_-2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.03)]">
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
              <div className="term-input-area px-3 py-2 bg-term-panel shrink-0">
                {isTeamMember ? (
                  <div className="text-center text-muted-foreground font-mono text-term py-2">
                    Tasks are assigned by the Team Lead
                  </div>
                ) : cardPhase === "execute" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div className="term-input-well">
                      <span style={{ color: busy ? TERM_DIM : TERM_ACCENT, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: "none" }}>&gt;</span>
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
                          fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_ACCENT,
                          resize: "none", lineHeight: "20px",
                        }}
                      />
                    </div>
                    {!busy && (
                      <span
                        onClick={onEndProject}
                        style={{ padding: "2px 8px 4px", color: TERM_DIM, fontSize: TERM_SIZE_SM, cursor: "pointer", fontFamily: TERM_FONT }}
                      >close project</span>
                    )}
                  </div>
                ) : cardPhase === "design" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    <button
                      className="term-btn"
                      onClick={onApprovePlan}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_ACCENT}60`,
                        backgroundColor: "transparent", color: TERM_ACCENT, fontSize: TERM_SIZE, cursor: "pointer",
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
                        fontFamily: TERM_FONT, caretColor: TERM_ACCENT,
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
                        fontFamily: TERM_FONT, caretColor: TERM_ACCENT,
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
                ) : !busy && isOwner && !teamId && !isTeamMember && pendingMerge ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    {!autoMerge && onMerge && (
                      <button
                        className="term-btn"
                        onClick={onMerge}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 14px", border: `1px solid ${TERM_ACCENT}60`,
                          backgroundColor: "transparent", color: TERM_ACCENT, fontSize: TERM_SIZE, cursor: "pointer",
                          fontFamily: TERM_FONT, flexShrink: 0,
                        }}
                      ><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6M4 3v10M4 13l4-4 4 0"/></svg>Merge</button>
                    )}
                    {!autoMerge && onRevert && (
                      <button
                        className="term-btn"
                        onClick={onRevert}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 14px", border: `1px solid ${TERM_SEM_YELLOW}40`,
                          backgroundColor: "transparent", color: TERM_SEM_YELLOW, fontSize: TERM_SIZE, cursor: "pointer",
                          fontFamily: TERM_FONT, flexShrink: 0,
                        }}
                      ><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l4-4 4 4"/><path d="M6 2v8a4 4 0 0 0 4 4h2"/></svg>Revert</button>
                    )}
                    <div className="term-input-well" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "0 0 0 8px", flexShrink: 0 }}>&gt;</span>
                    <textarea
                      ref={inputRef}
                      rows={1}
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => { onPromptChange(e.target.value); autoResize(e.currentTarget); }}
                      onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); onSubmit(); } }}
                      placeholder="send a new task..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_ACCENT,
                        resize: "none", lineHeight: "20px",
                      }}
                    />
                    </div>
                  </div>
                ) : awaitingApproval && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    <button
                      className="term-btn"
                      onClick={onQuickApprove}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_ACCENT}60`,
                        backgroundColor: "transparent", color: TERM_ACCENT, fontSize: TERM_SIZE, cursor: "pointer",
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
                        fontFamily: TERM_FONT, caretColor: TERM_ACCENT,
                        resize: "none", lineHeight: "20px",
                      }}
                    />
                    </div>
                  </div>
                ) : (
                  <div className="term-input-well">
                    <span style={{ color: busy ? TERM_DIM : TERM_ACCENT, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: "none" }}>&gt;</span>
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
                        fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_ACCENT,
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
    </div>
  );
});

export default AgentPane;
