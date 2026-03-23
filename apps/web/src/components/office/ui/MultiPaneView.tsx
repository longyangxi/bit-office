import { memo, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ReviewerOverlayData } from "./AgentPane";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_PANEL, TERM_BORDER_DIM, TERM_BORDER, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_GREEN } from "./termTheme";
import { getStatusConfig, BACKEND_OPTIONS } from "./office-constants";

const AgentPane = dynamic(() => import("./AgentPane"), { ssr: false });
const SpriteAvatar = dynamic(() => import("./SpriteAvatar"), { ssr: false });

const MAX_VISIBLE = 3;

/** Per-pane wrapper that stabilizes callback references via useRef so AgentPane memo is effective */
const StableAgentPane = memo(function StableAgentPane({
  agentId, data, meta, assetsReady,
  panePrompts, onPanePromptChange,
  isOwner, isCollaborator, isSpectator,
  panePendingImages, onPanePendingImagesChange,
  suggestions, suggestText, onSuggestTextChange,
  onSubmit, onCancel, onFire, onApproval, onApprovePlan, onQuickApprove,
  onEndProject, onSuggest, onPreview, onReview, detectedBackends,
  onLoadMore, onPasteImage, onPasteText, onDropImage,
  reviewerOverlay, onReviewerLoadMore, onApplyReviewFixes, onDismissReview,
  onMerge, onRevert, onUndoMerge,
  scrollFrozen,
}: {
  agentId: string;
  data: AgentData;
  meta?: { agentId: string; name: string; palette: number; isTeamLead: boolean };
  assetsReady?: boolean;
  panePrompts: Map<string, string>;
  onPanePromptChange: (agentId: string, value: string) => void;
  isOwner: boolean;
  isCollaborator: boolean;
  isSpectator: boolean;
  panePendingImages: Map<string, { name: string; dataUrl: string; base64: string }[]>;
  onPanePendingImagesChange: (agentId: string, imgs: { name: string; dataUrl: string; base64: string }[]) => void;
  suggestions: { text: string; author: string; timestamp: number }[];
  suggestText: string;
  onSuggestTextChange: (val: string) => void;
  onSubmit: (agentId: string) => void;
  onCancel: (agentId: string) => void;
  onFire: (agentId: string) => void;
  onApproval: (approvalId: string, decision: "yes" | "no") => void;
  onApprovePlan: (agentId: string) => void;
  onQuickApprove: (agentId: string) => void;
  onEndProject: (agentId: string) => void;
  onSuggest: () => void;
  onPreview: (url: string) => void;
  onReview?: (agentId: string, result: any, backend?: string) => void;
  detectedBackends?: string[];
  onLoadMore: (agentId: string) => void;
  onPasteImage: (agentId: string, e: React.ClipboardEvent) => void;
  onPasteText: (agentId: string, e: React.ClipboardEvent<HTMLElement>) => void;
  onDropImage: (agentId: string, e: React.DragEvent) => void;
  reviewerOverlay?: any;
  onReviewerLoadMore?: () => void;
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
  onMerge?: (agentId: string) => void;
  onRevert?: (agentId: string) => void;
  onUndoMerge?: (agentId: string) => void;
  scrollFrozen?: boolean;
}) {
  // Stable callbacks — useRef + useCallback pattern avoids creating new references
  const idRef = useRef(agentId);
  idRef.current = agentId;

  const handlePromptChange = useCallback((val: string) => onPanePromptChange(idRef.current, val), [onPanePromptChange]);
  const handlePendingImagesChange = useCallback((imgs: { name: string; dataUrl: string; base64: string }[]) => onPanePendingImagesChange(idRef.current, imgs), [onPanePendingImagesChange]);
  const handleSubmit = useCallback(() => onSubmit(idRef.current), [onSubmit]);
  const handleCancel = useCallback(() => onCancel(idRef.current), [onCancel]);
  const handleApprovePlan = useCallback(() => onApprovePlan(idRef.current), [onApprovePlan]);
  const handleQuickApprove = useCallback(() => onQuickApprove(idRef.current), [onQuickApprove]);
  const handleEndProject = useCallback(() => onEndProject(idRef.current), [onEndProject]);
  const handleLoadMore = useCallback(() => onLoadMore(idRef.current), [onLoadMore]);
  const handlePasteImage = useCallback((e: React.ClipboardEvent) => onPasteImage(idRef.current, e), [onPasteImage]);
  const handlePasteText = useCallback((e: React.ClipboardEvent<HTMLElement>) => onPasteText(idRef.current, e), [onPasteText]);
  const handleDropImage = useCallback((e: React.DragEvent) => onDropImage(idRef.current, e), [onDropImage]);
  const handleReview = useCallback(onReview ? (result: any, backend?: string) => onReview(idRef.current, result, backend) : undefined as any, [onReview]);

  return (
    <>
      {/* Inline avatar header for this pane (console mode only) */}
      {meta && (() => {
        const statusKey = data.status ?? "idle";
        const cfg = getStatusConfig()[statusKey] ?? getStatusConfig().idle;
        const backendName = data.backend ? (BACKEND_OPTIONS.find((b) => b.id === data.backend)?.name ?? data.backend) : null;
        const roleName = data.role?.split("\u2014")[0]?.trim();
        const statusColor = data.busy ? TERM_GREEN
          : statusKey === "waiting_approval" ? TERM_SEM_YELLOW
          : statusKey === "error" ? TERM_SEM_RED
          : statusKey === "done" ? TERM_SEM_GREEN
          : TERM_BORDER;
        return (
          <div className="term-info-bar" style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px",
            background: TERM_PANEL,
            flexShrink: 0,
          }}>
            {/* Avatar with status ring */}
            <div style={{
              position: "relative", width: 26, height: 30,
              overflow: "hidden", borderRadius: 3, flexShrink: 0,
              border: `1.5px solid ${statusColor}`,
              transition: "border-color 0.3s ease",
            }}>
              <div style={{ marginTop: -1 }}>
                <SpriteAvatar palette={meta.palette} zoom={1.6} ready={assetsReady ?? false} />
              </div>
              {data.busy && (
                <span style={{
                  position: "absolute", top: 1, right: 1,
                  width: 5, height: 5, borderRadius: "50%",
                  backgroundColor: TERM_GREEN,
                  boxShadow: `0 0 4px ${TERM_GREEN}40`,
                  animation: "px-pulse-gold 1.5s ease infinite",
                }} />
              )}
            </div>
            {/* Name · Backend · Role */}
            <div style={{
              display: "flex", alignItems: "center", gap: 0,
              overflow: "hidden", whiteSpace: "nowrap", minWidth: 0,
              fontFamily: TERM_FONT,
            }}>
              <span style={{
                fontSize: TERM_SIZE, color: TERM_TEXT_BRIGHT, fontWeight: 600,
                letterSpacing: "-0.01em", flexShrink: 0,
              }}>{meta.name}</span>
              {meta.isTeamLead && (
                <span style={{
                  fontSize: 8, fontFamily: TERM_FONT,
                  color: TERM_SEM_YELLOW, fontWeight: 700,
                  padding: "0 3px", lineHeight: "14px", marginLeft: 5,
                  border: `1px solid ${TERM_SEM_YELLOW}40`,
                  borderRadius: 3, flexShrink: 0,
                }}>LEAD</span>
              )}
              {backendName && (
                <>
                  <span style={{ color: TERM_DIM, margin: "0 6px", opacity: 0.5, fontSize: 10, flexShrink: 0 }}>{"\u00b7"}</span>
                  <span style={{ fontSize: TERM_SIZE - 1, color: TERM_TEXT_BRIGHT, opacity: 0.6, flexShrink: 0 }}>{backendName}</span>
                </>
              )}
              {roleName && (
                <>
                  <span style={{ color: TERM_DIM, margin: "0 6px", opacity: 0.5, fontSize: 10, flexShrink: 0 }}>{"\u00b7"}</span>
                  <span style={{
                    fontSize: TERM_SIZE - 1, color: TERM_TEXT_BRIGHT, opacity: 0.45,
                    overflow: "hidden", textOverflow: "ellipsis",
                  }}>{roleName}</span>
                </>
              )}
            </div>
          </div>
        );
      })()}
      <AgentPane
        agentId={agentId}
        name={data.name}
        role={data.role}
        backend={data.backend}
        status={data.status}
        cwd={data.cwd}
        workDir={data.workDir}
        messages={data.messages}
        visibleMessages={data.visibleMessages}
        hasMoreMessages={data.hasMoreMessages}
        tokenUsage={data.tokenUsage}
        isTeamLead={data.isTeamLead}
        isTeamMember={data.isTeamMember}
        isExternal={data.isExternal}
        teamId={data.teamId}
        teamPhase={data.teamPhase}
        pendingApproval={data.pendingApproval}
        awaitingApproval={data.awaitingApproval}
        lastLogLine={data.lastLogLine}
        busy={data.busy}
        pid={data.pid}
        isOwner={isOwner}
        isCollaborator={isCollaborator}
        isSpectator={isSpectator}
        prompt={panePrompts.get(agentId) || ""}
        onPromptChange={handlePromptChange}
        pendingImages={panePendingImages.get(agentId) || []}
        onPendingImagesChange={handlePendingImagesChange}
        suggestions={suggestions}
        suggestText={suggestText}
        onSuggestTextChange={onSuggestTextChange}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        onFire={onFire}
        onApproval={onApproval}
        onApprovePlan={handleApprovePlan}
        onQuickApprove={handleQuickApprove}
        onEndProject={handleEndProject}
        onSuggest={onSuggest}
        onPreview={onPreview}
        onReview={handleReview}
        detectedBackends={detectedBackends}
        onLoadMore={handleLoadMore}
        onPasteImage={handlePasteImage}
        onPasteText={handlePasteText}
        onDropImage={handleDropImage}
        reviewerOverlay={reviewerOverlay}
        onReviewerLoadMore={onReviewerLoadMore}
        onApplyReviewFixes={onApplyReviewFixes}
        onDismissReview={onDismissReview}
        onMerge={onMerge ? () => onMerge(agentId) : undefined}
        onRevert={onRevert ? () => onRevert(agentId) : undefined}
        onUndoMerge={onUndoMerge ? () => onUndoMerge(agentId) : undefined}
        scrollFrozen={scrollFrozen}
        hideInfoRole={!!meta}
      />
    </>
  );
});

interface AgentData {
  agentId: string;
  name: string;
  role?: string;
  backend?: string;
  status: string;
  cwd?: string | null;
  workDir?: string | null;
  messages: any[];
  visibleMessages: any[];
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
  autoMerge?: boolean;
  pendingMerge?: boolean;
  lastMergeCommit?: string | null;
  lastMergeMessage?: string | null;
}

export interface MultiPaneViewProps {
  openPanes: string[];
  getAgentData: (agentId: string) => AgentData | null;
  paneOffset: number;
  onPaneOffsetChange: (offset: number) => void;
  panePrompts: Map<string, string>;
  onPanePromptChange: (agentId: string, value: string) => void;
  isOwner: boolean;
  isCollaborator: boolean;
  isSpectator: boolean;
  panePendingImages: Map<string, { name: string; dataUrl: string; base64: string }[]>;
  onPanePendingImagesChange: (agentId: string, imgs: { name: string; dataUrl: string; base64: string }[]) => void;
  suggestions: { text: string; author: string; timestamp: number }[];
  suggestText: string;
  onSuggestTextChange: (val: string) => void;
  onSubmit: (agentId: string) => void;
  onCancel: (agentId: string) => void;
  onFire: (agentId: string) => void;
  onApproval: (approvalId: string, decision: "yes" | "no") => void;
  onApprovePlan: (agentId: string) => void;
  onQuickApprove: (agentId: string) => void;
  onEndProject: (agentId: string) => void;
  onSuggest: () => void;
  onPreview: (url: string) => void;
  onReview?: (agentId: string, result: { changedFiles: string[]; projectDir?: string; entryFile?: string; summary: string }, backend?: string) => void;
  detectedBackends?: string[];
  onLoadMore: (agentId: string) => void;
  onPasteImage: (agentId: string, e: React.ClipboardEvent) => void;
  onPasteText: (agentId: string, e: React.ClipboardEvent<HTMLElement>) => void;
  onDropImage: (agentId: string, e: React.DragEvent) => void;
  // Review overlay support
  reviewOverlay?: { reviewerAgentId: string; sourceAgentId: string } | null;
  getReviewerData?: (reviewerAgentId: string) => ReviewerOverlayData | null;
  onReviewerLoadMore?: (agentId: string) => void;
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
  // Merge controls
  onMerge?: (agentId: string) => void;
  onRevert?: (agentId: string) => void;
  onUndoMerge?: (agentId: string) => void;
  /** Freeze scroll management during CSS width transitions */
  scrollFrozen?: boolean;
  /** Agent metadata for inline avatar headers (console mode) */
  agentMeta?: { agentId: string; name: string; palette: number; isTeamLead: boolean }[];
  assetsReady?: boolean;
  /** Show hire/create button after last pane */
  showHireButton?: boolean;
  hireLabel?: string;
  onHire?: () => void;
  /** Team controls (stop/fire) shown after last pane */
  showTeamControls?: boolean;
  teamBusy?: boolean;
  onStopTeam?: () => void;
  onFireTeam?: () => void;
}

const MultiPaneView = memo(function MultiPaneView(props: MultiPaneViewProps) {
  const {
    openPanes,
    getAgentData,
    paneOffset,
    onPaneOffsetChange,
    panePrompts,
    onPanePromptChange,
    isOwner,
    isCollaborator,
    isSpectator,
    panePendingImages,
    onPanePendingImagesChange,
    suggestions,
    suggestText,
    onSuggestTextChange,
    onSubmit,
    onCancel,
    onFire,
    onApproval,
    onApprovePlan,
    onQuickApprove,
    onEndProject,
    onSuggest,
    onPreview,
    onReview,
    onLoadMore,
    onPasteImage,
    onPasteText,
    onDropImage,
    reviewOverlay,
    getReviewerData,
    onReviewerLoadMore,
    onApplyReviewFixes,
    onDismissReview,
    detectedBackends,
    scrollFrozen,
    agentMeta,
    assetsReady,
    showHireButton,
    hireLabel = "hire",
    onHire,
    showTeamControls,
    teamBusy,
    onMerge,
    onRevert,
    onUndoMerge,
    onStopTeam,
    onFireTeam,
  } = props;

  // ── Simple state-driven pagination ──
  // currentPage=0 on every fresh mount (conditional render guarantees remount).
  // NO mount effects — just useState(0). Conditional render guarantees fresh mount.
  const [currentPage, setCurrentPage] = useState(0);
  // Track slide direction for animation: "left" = next page, "right" = prev page
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Pane resize logic (within a page) ──
  const [paneWidths, setPaneWidths] = useState<number[]>([]);
  const dragRef = useRef<{ index: number; startX: number; startWidths: number[]; containerW: number } | null>(null);

  const totalPages = Math.ceil(openPanes.length / MAX_VISIBLE);

  // Build pages: each page holds up to MAX_VISIBLE panes
  const pages: string[][] = [];
  for (let i = 0; i < openPanes.length; i += MAX_VISIBLE) {
    pages.push(openPanes.slice(i, i + MAX_VISIBLE));
  }

  // Clamp currentPage when panes change
  const clampedPage = Math.max(0, Math.min(currentPage, totalPages - 1));
  if (clampedPage !== currentPage) {
    setCurrentPage(clampedPage);
    onPaneOffsetChange(clampedPage * MAX_VISIBLE);
  }

  // Blur any auto-focused input after mount and page changes.
  // AgentPane auto-focuses its textarea on mount — override this so
  // keyboard arrows work for pagination immediately.
  useEffect(() => {
    const t = setTimeout(() => {
      if (document.activeElement instanceof HTMLElement &&
          (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
        document.activeElement.blur();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [currentPage]);

  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(0, Math.min(page, totalPages - 1));
    setCurrentPage(prev => {
      if (prev === clamped) return prev;
      setSlideDir(clamped > prev ? "left" : "right");
      return clamped;
    });
    onPaneOffsetChange(clamped * MAX_VISIBLE);
  }, [totalPages, onPaneOffsetChange]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (totalPages <= 1) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goToPage(currentPage - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goToPage(currentPage + 1); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, totalPages, goToPage]);

  // Mouse wheel pagination: scroll to change pages.
  // Skips when mouse is over a scrollable area (chat messages, code blocks, etc.)
  const wheelCooldown = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || totalPages <= 1) return;
    const handleWheel = (e: WheelEvent) => {
      // Walk up from target — if any ancestor can scroll, let the browser handle it
      let node = e.target as HTMLElement | null;
      while (node && node !== el) {
        if (node.tagName === "TEXTAREA" || node.tagName === "INPUT") return;
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return;
        node = node.parentElement;
      }
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 30) return;
      if (wheelCooldown.current) return;
      wheelCooldown.current = true;
      setTimeout(() => { wheelCooldown.current = false; }, 400);
      if (delta > 0) goToPage(currentPage + 1);
      else goToPage(currentPage - 1);
    };
    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [currentPage, totalPages, goToPage]);

  // Touch swipe support
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current || totalPages <= 1) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.startX;
    const dy = e.changedTouches[0].clientY - touchRef.current.startY;
    touchRef.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // too short or vertical
    if (dx < 0) goToPage(currentPage + 1); // swipe left → next
    else goToPage(currentPage - 1); // swipe right → prev
  }, [currentPage, totalPages, goToPage]);

  // Pane resize within a page
  const startResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const containerW = el.getBoundingClientRect().width;
    const count = Math.min(pages[currentPage]?.length ?? 0, MAX_VISIBLE);
    const currentWidths = paneWidths.length === count ? [...paneWidths] : Array(count).fill(1 / count);
    dragRef.current = { index, startX: e.clientX, startWidths: currentWidths, containerW };

    const onMouseMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (ev.clientX - d.startX) / d.containerW;
      const newWidths = [...d.startWidths];
      const minW = 0.15;
      const left = d.startWidths[d.index] + delta;
      const right = d.startWidths[d.index + 1] - delta;
      if (left >= minW && right >= minW) {
        newWidths[d.index] = left;
        newWidths[d.index + 1] = right;
        setPaneWidths(newWidths);
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [currentPage, pages, paneWidths]);

  // Reset pane widths when page or pane count changes
  const prevPagePaneCount = useRef(0);
  const activePaneCount = pages[currentPage]?.length ?? 0;
  if (activePaneCount !== prevPagePaneCount.current) {
    prevPagePaneCount.current = activePaneCount;
    if (paneWidths.length !== activePaneCount) {
      setPaneWidths(Array(activePaneCount).fill(1 / Math.max(1, activePaneCount)));
    }
  }

  // Check trailing team controls (last page only)
  const isLastPage = currentPage >= totalPages - 1;
  const hasTrailingControls = isLastPage && showTeamControls;

  if (openPanes.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          fontFamily: TERM_FONT,
          fontSize: TERM_SIZE,
          color: TERM_DIM,
          minHeight: 0,
        }}
      >
        {showHireButton && onHire ? (
          <button
            onClick={onHire}
            title="Hire"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "14px 36px",
              border: `1px solid ${TERM_GREEN}50`, cursor: "pointer",
              backgroundColor: `${TERM_GREEN}12`, color: `${TERM_GREEN}cc`,
              fontSize: 13, fontFamily: TERM_FONT, fontWeight: 500,
              borderRadius: 8, transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}25`; e.currentTarget.style.borderColor = `${TERM_GREEN}90`; e.currentTarget.style.color = TERM_GREEN; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}12`; e.currentTarget.style.borderColor = `${TERM_GREEN}50`; e.currentTarget.style.color = `${TERM_GREEN}cc`; }}
          >
            <span style={{ fontSize: 15, lineHeight: "1" }}>+</span> {hireLabel}
          </button>
        ) : (
          "No agents active"
        )}
      </div>
    );
  }

  // Flex values for panes in the current page
  const flexValues = paneWidths.length === activePaneCount
    ? paneWidths
    : Array(activePaneCount).fill(1 / Math.max(1, activePaneCount));

  const pagePanes = pages[currentPage] ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Only render the current page — simple and bulletproof */}
      <div
        key={currentPage}
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={slideDir === "left" ? "mpv-slide-left" : slideDir === "right" ? "mpv-slide-right" : "mpv-page-fade"}
        style={{ display: "flex", flex: 1, minHeight: 0 }}
      >
        {pagePanes.map((agentId, i) => {
          const data = getAgentData(agentId);
          if (!data) return null;
          const meta = agentMeta?.find(m => m.agentId === agentId);
          const flex = flexValues[i] != null ? `${flexValues[i]} 1 0%` : "1 1 0%";
          return (
            <div key={agentId} style={{ display: "contents" }}>
              {i > 0 && (
                <div
                  className={`pane-resize${dragRef.current?.index === i - 1 ? " pane-resize-active" : ""}`}
                  onMouseDown={(e) => startResize(i - 1, e)}
                />
              )}
              <div
                style={{
                  flex,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  ...(i === 0 ? {
                    borderLeft: `1px solid ${TERM_BORDER}`,
                    boxShadow: `-1px 0 0 rgba(0,0,0,0.4), inset 1px 0 0 rgba(255,255,255,0.03)`,
                  } : {}),
                }}
              >
                {showHireButton && onHire && currentPage === pages.length - 1 && i === pagePanes.length - 1 && (
                  <button onClick={onHire} title="Hire" aria-label="Hire" className="mpv-hire-float">
                    <span style={{ fontSize: 13, lineHeight: "1" }}>+</span> {hireLabel}
                  </button>
                )}
                <StableAgentPane
                  agentId={agentId}
                  data={data}
                  meta={meta}
                  assetsReady={assetsReady}
                  panePrompts={panePrompts}
                  onPanePromptChange={onPanePromptChange}
                  isOwner={isOwner}
                  isCollaborator={isCollaborator}
                  isSpectator={isSpectator}
                  panePendingImages={panePendingImages}
                  onPanePendingImagesChange={onPanePendingImagesChange}
                  suggestions={suggestions}
                  suggestText={suggestText}
                  onSuggestTextChange={onSuggestTextChange}
                  onSubmit={onSubmit}
                  onCancel={onCancel}
                  onFire={onFire}
                  onApproval={onApproval}
                  onApprovePlan={onApprovePlan}
                  onQuickApprove={onQuickApprove}
                  onEndProject={onEndProject}
                  onSuggest={onSuggest}
                  onPreview={onPreview}
                  onReview={onReview}
                  detectedBackends={detectedBackends}
                  onLoadMore={onLoadMore}
                  onPasteImage={onPasteImage}
                  onPasteText={onPasteText}
                  onDropImage={onDropImage}
                  reviewerOverlay={reviewOverlay?.sourceAgentId === agentId && getReviewerData ? getReviewerData(reviewOverlay.reviewerAgentId) : null}
                  onReviewerLoadMore={reviewOverlay?.sourceAgentId === agentId && onReviewerLoadMore ? () => onReviewerLoadMore(reviewOverlay.reviewerAgentId) : undefined}
                  onApplyReviewFixes={reviewOverlay?.sourceAgentId === agentId ? onApplyReviewFixes : undefined}
                  onDismissReview={reviewOverlay?.sourceAgentId === agentId ? onDismissReview : undefined}
                  onMerge={onMerge}
                  onRevert={onRevert}
                  onUndoMerge={onUndoMerge}
                  scrollFrozen={scrollFrozen}
                />
              </div>
            </div>
          );
        })}

        {/* Trailing team controls on last page */}
        {hasTrailingControls && (
          <div
            style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 8, padding: "0 16px",
              borderLeft: pagePanes.length > 0 ? `1px solid ${TERM_BORDER_DIM}` : undefined,
              minWidth: 60, flexShrink: 0,
            }}
          >
            {showTeamControls && teamBusy && onStopTeam && (
              <button
                onClick={onStopTeam}
                title="Stop Team Work"
                style={{
                  padding: "6px 12px",
                  border: `1px solid ${TERM_DIM}`, cursor: "pointer",
                  backgroundColor: "transparent", color: TERM_SEM_YELLOW,
                  fontSize: TERM_SIZE, fontFamily: TERM_FONT,
                }}
              >stop</button>
            )}
            {showTeamControls && onFireTeam && (
              <button
                onClick={onFireTeam}
                title="Fire Team"
                style={{
                  padding: "6px 12px",
                  border: `1px solid ${TERM_DIM}`, cursor: "pointer",
                  backgroundColor: "transparent", color: TERM_DIM,
                  fontSize: TERM_SIZE, fontFamily: TERM_FONT,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = TERM_SEM_RED; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; }}
              >fire</button>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar: page dots + hire button */}
      <div
        className="term-info-bar"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "5px 12px",
          fontFamily: TERM_FONT,
          fontSize: TERM_SIZE - 1,
          color: TERM_DIM,
          background: TERM_PANEL,
          flexShrink: 0,
          position: "relative",
          gap: 8,
          boxShadow: `0 -3px 6px -2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)`,
        }}
      >
        {/* Center: page indicator dots */}
        {totalPages > 1 && (
          <div className="mpv-dots">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                className={`mpv-dot${currentPage === i ? " mpv-dot-active" : ""}`}
                onClick={() => goToPage(i)}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
});

export default MultiPaneView;
