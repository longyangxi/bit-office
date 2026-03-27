import { useRef, useEffect, memo, useCallback, useState } from "react";
import { useScrollAnchor } from "./useScrollAnchor";
import { getStatusConfig, BACKEND_OPTIONS } from "./office-constants";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_BG, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_BLUE, TERM_SEM_CYAN } from "./termTheme";
import { isRealEnter } from "./office-utils";
import { SysMsg, TokenBadge, MdContent } from "./MessageBubble";
import { TermButton, TermInput, TermEmpty } from "./primitives";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
    <div className="px-3.5 py-2 font-mono text-term shrink-0" style={{
      background: `color-mix(in srgb, ${TERM_GREEN} 5%, ${TERM_PANEL})`,
      boxShadow: `inset 0 1px 0 ${TERM_GREEN}10`,
    }}>
      {/* Feedback input — only show when fixes are available */}
      {onApplyReviewFixes && (
        <div className="flex gap-1.5 items-center mb-2">
          <TermInput
            ref={inputRef}
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onApplyReviewFixes(feedback || undefined);
              }
            }}
            placeholder="Add feedback for the fix..."
            className=""
            style={{ flex: 1 }}
          />
        </div>
      )}
      {/* Action buttons */}
      <div className="flex gap-2 justify-center">
        {onApplyReviewFixes && (
          <TermButton
            variant="success"
            size="sm"
            onClick={() => onApplyReviewFixes(feedback || undefined)}
          >apply fixes</TermButton>
        )}
        {onDismissReview && (
          <TermButton
            variant="ghost"
            size="sm"
            onClick={onDismissReview}
          >Dismiss</TermButton>
        )}
      </div>
    </div>
  );
}

/** Matrix-style binary rain on canvas — each column spawns at random x/y */
function MatrixRainCanvas({ color, font }: { color: string; font: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const fontSize = 14;
    const lineH = 20;
    const colCount = 6;      // max simultaneous columns
    const digitCount = 12;   // digits per column
    const speed = 60;        // px per second

    interface Drop { x: number; y: number; digits: string[]; opacity: number; speed: number }
    const drops: Drop[] = [];

    function spawnDrop(randomY: boolean): Drop {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(cvs!.width / dpr, cvs!.clientWidth || 300);
      const h = Math.max(cvs!.height / dpr, cvs!.clientHeight || 150);
      return {
        x: Math.random() * w,
        y: randomY
          ? Math.random() * h              // anywhere in visible area
          : -(Math.random() * 0.3 + 0.1) * h, // just above visible area
        digits: Array.from({ length: digitCount }, () => Math.random() > 0.5 ? "1" : "0"),
        opacity: 0.12 + Math.random() * 0.14,
        speed: speed + Math.random() * 40,
      };
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = cvs!.getBoundingClientRect();
      cvs!.width = rect.width * dpr;
      cvs!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    // Init AFTER resize so canvas dimensions are correct
    for (let i = 0; i < colCount; i++) {
      drops.push(spawnDrop(true));
    }

    let lastT = performance.now();
    function draw(t: number) {
      const dt = (t - lastT) / 1000;
      lastT = t;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(cvs!.width / dpr, cvs!.clientWidth || 300);
      const h = Math.max(cvs!.height / dpr, cvs!.clientHeight || 150);
      ctx!.clearRect(0, 0, w, h);
      ctx!.font = `${fontSize}px ${font}`;
      ctx!.textAlign = "center";

      for (const d of drops) {
        d.y += d.speed * dt;
        ctx!.fillStyle = color;
        ctx!.globalAlpha = d.opacity;
        for (let j = 0; j < d.digits.length; j++) {
          const dy = d.y + j * lineH;
          if (dy > -lineH && dy < h + lineH) {
            ctx!.fillText(d.digits[j], d.x, dy);
          }
        }
        // Reset when fully off bottom
        if (d.y > h + lineH) {
          Object.assign(d, spawnDrop(false));
        }
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [color, font]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
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
              <span className="text-[13px] text-term-text-bright font-medium tracking-tight shrink-0">{inlineAvatar.name}</span>
              {inlineAvatar.isTeamLead && (
                <span
                  className="text-[9px] font-mono font-bold text-sem-yellow px-[3px] leading-[15px] rounded-sm shrink-0"
                  style={{ border: `1px solid ${TERM_SEM_YELLOW}40` }}
                >LEAD</span>
              )}
              {backendName && (
                <span className="text-[11px] text-term-text opacity-60 shrink-0 tracking-wide">
                  {backendName}
                </span>
              )}
              {roleName && (
                <span className="text-[11px] text-term-text opacity-45 shrink-0 tracking-wide hidden sm:inline">
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
        {tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={tokenUsage.inputTokens} outputTokens={tokenUsage.outputTokens} />}
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
        <div style={{
          position: "absolute", inset: 0, zIndex: 20,
          display: "flex", flexDirection: "column",
          background: `color-mix(in srgb, ${TERM_GREEN} 4%, ${TERM_BG})`,
          animation: "review-overlay-in 0.3s ease-out",
          overflow: "hidden",
        }}>
          {/* Header bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 14px",
            background: `color-mix(in srgb, ${TERM_GREEN} 6%, ${TERM_PANEL})`,
            boxShadow: `inset 0 -1px 0 ${TERM_GREEN}15`,
            fontSize: TERM_SIZE, fontFamily: TERM_FONT,
            flexShrink: 0,
          }}>
            <span style={{ color: TERM_GREEN, fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `${TERM_GREEN}18`, letterSpacing: "0.04em", textTransform: "uppercase" }}>REVIEW</span>
            <span style={{ color: TERM_TEXT_BRIGHT }}>
              {reviewerOverlay.name}
            </span>
            {/* Scanning indicator (busy) */}
            {reviewerOverlay.busy && (
              <span className="working-dots" style={{ color: TERM_GREEN }}>
                <span className="working-dots-mid" />
              </span>
            )}
            {/* Verdict badge (done) */}
            {!reviewerOverlay.busy && reviewerOverlay.verdict && reviewerOverlay.verdict !== "UNKNOWN" && (
              <span style={{
                fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
                letterSpacing: "0.04em", textTransform: "uppercase",
                color: reviewerOverlay.verdict === "PASS" ? TERM_SEM_GREEN : TERM_SEM_RED,
                background: reviewerOverlay.verdict === "PASS" ? `${TERM_SEM_GREEN}18` : `${TERM_SEM_RED}18`,
              }}>{reviewerOverlay.verdict}</span>
            )}
            {!reviewerOverlay.busy && reviewerOverlay.status === "error" && (
              <span style={{ color: TERM_SEM_RED, fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `${TERM_SEM_RED}18`, letterSpacing: "0.04em", textTransform: "uppercase" }}>ERROR</span>
            )}
            <span style={{ flex: 1 }} />
            {reviewerOverlay.tokenUsage.inputTokens > 0 && (
              <TokenBadge inputTokens={reviewerOverlay.tokenUsage.inputTokens} outputTokens={reviewerOverlay.tokenUsage.outputTokens} />
            )}
            {reviewerOverlay.busy && onDismissReview && (
              <button
                onClick={onDismissReview}
                style={{
                  padding: "1px 6px", border: `1px solid ${TERM_BORDER}`,
                  borderRadius: 3, backgroundColor: "transparent", color: TERM_DIM,
                  fontSize: TERM_SIZE, fontFamily: TERM_FONT,
                  cursor: "pointer", flexShrink: 0, lineHeight: 1.2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = TERM_TEXT; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; }}
              >{"\u00d7"}</button>
            )}
          </div>

          {/* ── Body: scanning animation (busy) or results (done) ── */}
          {reviewerOverlay.busy ? (
            /* Scanning animation */
            <div style={{
              flex: 1, position: "relative", overflow: "hidden",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              minHeight: 0,
            }}>
              {/* Grid lines background */}
              <div className="review-scan-grid" style={{
                position: "absolute", inset: 0, opacity: 0.06,
                backgroundImage: `linear-gradient(${TERM_GREEN} 1px, transparent 1px), linear-gradient(90deg, ${TERM_GREEN} 1px, transparent 1px)`,
                backgroundSize: "24px 24px",
              }} />
              {/* Matrix-style falling binary digits — canvas */}
              <MatrixRainCanvas color={TERM_GREEN} font={TERM_FONT} />
              {/* Sweep line */}
              <div className="review-scan-sweep" style={{
                position: "absolute", left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg, transparent, ${TERM_GREEN}, transparent)`,
                boxShadow: `0 0 20px 4px ${TERM_GREEN}50, 0 0 60px 8px ${TERM_GREEN}20`,
                animation: "review-scan-sweep 2.4s ease-in-out infinite",
              }} />
              {/* Glow trail behind sweep */}
              <div className="review-scan-trail" style={{
                position: "absolute", left: 0, right: 0, height: 40,
                background: `linear-gradient(180deg, ${TERM_GREEN}12, transparent)`,
                animation: "review-scan-sweep 2.4s ease-in-out infinite",
              }} />
              {/* Center content */}
              <div style={{
                position: "relative", zIndex: 1, textAlign: "center",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              }}>
                {/* Pulsing ring */}
                <div style={{ position: "relative", width: 40, height: 40 }}>
                  <div className="review-scan-ring" style={{
                    position: "absolute", inset: 0, borderRadius: "50%",
                    border: `1.5px solid ${TERM_GREEN}60`,
                    animation: "review-scan-pulse 2s ease-in-out infinite",
                  }} />
                  <div style={{
                    position: "absolute", inset: 8, borderRadius: "50%",
                    background: `radial-gradient(circle, ${TERM_GREEN}30, transparent 70%)`,
                    animation: "review-scan-pulse 2s ease-in-out infinite 0.3s",
                  }} />
                  {/* Center dot */}
                  <div style={{
                    position: "absolute", top: "50%", left: "50%", width: 4, height: 4,
                    marginTop: -2, marginLeft: -2, borderRadius: "50%",
                    backgroundColor: TERM_GREEN,
                    boxShadow: `0 0 8px ${TERM_GREEN}`,
                  }} />
                </div>
                <span style={{
                  fontFamily: TERM_FONT, fontSize: TERM_SIZE, color: TERM_GREEN,
                  letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500,
                  opacity: 0.8,
                }}>
                  reviewing
                </span>
              </div>
              {/* Corner brackets — decorative */}
              {[
                { top: 12, left: 12, borderTop: `1px solid ${TERM_GREEN}30`, borderLeft: `1px solid ${TERM_GREEN}30` },
                { top: 12, right: 12, borderTop: `1px solid ${TERM_GREEN}30`, borderRight: `1px solid ${TERM_GREEN}30` },
                { bottom: 12, left: 12, borderBottom: `1px solid ${TERM_GREEN}30`, borderLeft: `1px solid ${TERM_GREEN}30` },
                { bottom: 12, right: 12, borderBottom: `1px solid ${TERM_GREEN}30`, borderRight: `1px solid ${TERM_GREEN}30` },
              ].map((pos, i) => (
                <div key={i} style={{ position: "absolute", width: 16, height: 16, ...pos } as React.CSSProperties} />
              ))}
            </div>
          ) : (
            /* Review results */
            <>
              <div data-scrollbar className="term-dotgrid term-chat-area" style={{
                flex: 1, overflowY: "auto", padding: "8px 14px",
                display: "flex", flexDirection: "column",
                minHeight: 0,
              }}>
                {(() => {
                  const reviewMsgs = reviewerOverlay.visibleMessages.filter(m => m.role !== "user" && m.text);
                  if (reviewMsgs.length > 0) {
                    return reviewMsgs.map(msg => (
                      <MessageBubble key={msg.id} msg={msg} agentName={reviewerOverlay.name} />
                    ));
                  }
                  if (reviewerOverlay.reviewResultText) {
                    return (
                      <div style={{ color: reviewerOverlay.status === "error" ? TERM_SEM_RED : TERM_TEXT, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "8px 0", wordBreak: "break-word", lineHeight: 1.7 }} className="chat-markdown">
                        <MdContent text={reviewerOverlay.reviewResultText} />
                      </div>
                    );
                  }
                  return (
                    <div style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "8px 0" }}>
                      (No review content)
                    </div>
                  );
                })()}
                <div ref={reviewChatEndRef} />
              </div>
              <ReviewFooter
                onApplyReviewFixes={reviewerOverlay.verdict === "FAIL" || (reviewerOverlay.reviewResultText && /\*{0,2}ISSUES:?\*{0,2}/i.test(reviewerOverlay.reviewResultText)) ? onApplyReviewFixes : undefined}
                onDismissReview={onDismissReview}
              />
            </>
          )}
        </div>
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
                ) : !busy && isOwner && !teamId && !isTeamMember && pendingMerge ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
                    {!autoMerge && onMerge && (
                      <button
                        className="term-btn"
                        onClick={onMerge}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                          backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
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
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
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
    </div>
  );
});

export default AgentPane;
