import { memo, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ReviewerOverlayData } from "./AgentPane";
import { TERM_GREEN, TERM_BORDER_DIM, TERM_BORDER } from "./termTheme";

import { cn } from "@/lib/utils";

const AgentPane = dynamic(() => import("./AgentPane"), { ssr: false });
const SpriteAvatar = dynamic(() => import("./SpriteAvatar"), { ssr: false });

/** Grid layout defaults */
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 1;

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
  autoMerge, pendingMerge, lastMergeCommit, lastMergeMessage, undoCount,
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
  autoMerge?: boolean;
  pendingMerge?: boolean;
  lastMergeCommit?: string | null;
  lastMergeMessage?: string | null;
  undoCount?: number;
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
        autoMerge={data.autoMerge}
        pendingMerge={data.pendingMerge}
        lastMergeCommit={data.lastMergeCommit}
        lastMergeMessage={data.lastMergeMessage}
        undoCount={data.undoCount}
        onMerge={onMerge ? () => onMerge(agentId) : undefined}
        onRevert={onRevert ? () => onRevert(agentId) : undefined}
        onUndoMerge={onUndoMerge ? () => onUndoMerge(agentId) : undefined}
        scrollFrozen={scrollFrozen}
        hideInfoRole={!!meta}
        inlineAvatar={meta ? { name: meta.name, palette: meta.palette, isTeamLead: meta.isTeamLead, assetsReady: assetsReady ?? false, AvatarComponent: SpriteAvatar } : null}
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
  undoCount?: number;
}

export interface MultiPaneViewProps {
  openPanes: string[];
  getAgentData: (agentId: string) => AgentData | null;
  paneOffset: number;
  onPaneOffsetChange: (offset: number) => void;
  /** Called when user drag-reorders panes — receives the new full ordering */
  onReorderPanes?: (newOrder: string[]) => void;
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
  /** Grid dimensions — configurable via Settings */
  cols?: number;
  rows?: number;
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
    onReorderPanes,
    cols: propCols,
    rows: propRows,
  } = props;

  const COLS = propCols ?? DEFAULT_COLS;
  const ROWS = propRows ?? DEFAULT_ROWS;
  const SLOTS_PER_PAGE = COLS * ROWS;

  // ── Drag-and-drop reorder state ──
  const dragSourceRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, agentId: string) => {
    // Only allow drag from info-bar area (the header)
    const target = e.target as HTMLElement;
    const infoBar = target.closest(".term-info-bar");
    if (!infoBar) { e.preventDefault(); return; }
    dragSourceRef.current = agentId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", agentId);
    // Use the cell as drag image
    const cell = (e.target as HTMLElement).closest(".mpv-cell") as HTMLElement | null;
    if (cell) e.dataTransfer.setDragImage(cell, 40, 20);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, agentId: string) => {
    if (!dragSourceRef.current || dragSourceRef.current === agentId) {
      setDragOverId(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(agentId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragSourceRef.current;
    setDragOverId(null);
    dragSourceRef.current = null;
    if (!sourceId || sourceId === targetId || !onReorderPanes) return;
    const order = [...openPanes];
    const srcIdx = order.indexOf(sourceId);
    const tgtIdx = order.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    order.splice(srcIdx, 1);
    order.splice(tgtIdx, 0, sourceId);
    onReorderPanes(order);
  }, [openPanes, onReorderPanes]);

  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null;
    setDragOverId(null);
  }, []);

  // ── Simple state-driven pagination ──
  const [currentPage, setCurrentPage] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Total pages: always at least 1 (for placeholders even with 0 panes).
  // When all slots on the last page are filled, add one extra page for the "+" placeholder.
  const filledPages = Math.max(1, Math.ceil(openPanes.length / SLOTS_PER_PAGE));
  const lastPageFull = openPanes.length > 0 && openPanes.length % SLOTS_PER_PAGE === 0;
  const totalPages = showHireButton && onHire && lastPageFull ? filledPages + 1 : filledPages;

  // Build pages: each page holds up to SLOTS_PER_PAGE pane ids
  const pages: string[][] = [];
  for (let i = 0; i < openPanes.length; i += SLOTS_PER_PAGE) {
    pages.push(openPanes.slice(i, i + SLOTS_PER_PAGE));
  }
  // Ensure we always have `totalPages` entries (extra empty pages for placeholders)
  while (pages.length < totalPages) pages.push([]);

  // Clamp currentPage when panes change
  const clampedPage = Math.max(0, Math.min(currentPage, totalPages - 1));
  if (clampedPage !== currentPage) {
    setCurrentPage(clampedPage);
    onPaneOffsetChange(clampedPage * SLOTS_PER_PAGE);
  }

  // Blur auto-focused inputs so keyboard arrows work for pagination
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
    onPaneOffsetChange(clamped * SLOTS_PER_PAGE);
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

  // Mouse wheel pagination
  const wheelCooldown = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || totalPages <= 1) return;
    const handleWheel = (e: WheelEvent) => {
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
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goToPage(currentPage + 1);
    else goToPage(currentPage - 1);
  }, [currentPage, totalPages, goToPage]);

  // Check trailing team controls (last page only)
  const isLastPage = currentPage >= totalPages - 1;
  const hasTrailingControls = isLastPage && showTeamControls;

  const pagePanes = pages[currentPage] ?? [];
  const emptySlots = SLOTS_PER_PAGE - pagePanes.length;

  // First empty slot on this page gets the "+" button
  const hireSlotIndex = showHireButton && onHire && emptySlots > 0 ? 0 : -1;

  // Build a flat list of SLOTS_PER_PAGE items: real panes + placeholders
  const slots: Array<{ type: "agent"; agentId: string } | { type: "placeholder"; index: number }> = [];
  for (const agentId of pagePanes) slots.push({ type: "agent", agentId });
  for (let i = 0; i < emptySlots; i++) slots.push({ type: "placeholder", index: i });

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ position: "relative" }}>
      {/* Floating team controls — top-right overlay */}
      {showTeamControls && (
        <div style={{
          position: "absolute", top: 38, right: 14, zIndex: 10,
          display: "flex", gap: 6, alignItems: "center",
        }}>
          {teamBusy && onStopTeam && (
            <button onClick={onStopTeam} title="Stop Team" className="tb tb-sm" style={{
              color: "var(--term-accent)", borderColor: "var(--term-accent)",
            }}>stop</button>
          )}
          {onFireTeam && (
            <button onClick={onFireTeam} title="Fire Team" className="tb tb-sm" style={{
              color: "var(--term-text)", borderColor: "var(--term-text)",
            }}>fire team</button>
          )}
        </div>
      )}
      {/* Current page — CSS Grid: COLS × ROWS */}
      <div
        key={currentPage}
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={cn("mpv-grid flex-1 min-h-0", slideDir === "left" ? "mpv-slide-left" : slideDir === "right" ? "mpv-slide-right" : "mpv-page-fade")}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        }}
      >
        {slots.map((slot) => {
          if (slot.type === "agent") {
            const { agentId } = slot;
            const data = getAgentData(agentId);
            if (!data) return null;
            const meta = agentMeta?.find(m => m.agentId === agentId);
            return (
              <div
                key={agentId}
                className={cn("mpv-cell", dragOverId === agentId && "mpv-drag-over")}
                draggable={!!onReorderPanes}
                onDragStart={onReorderPanes ? (e) => handleDragStart(e, agentId) : undefined}
                onDragOver={onReorderPanes ? (e) => handleDragOver(e, agentId) : undefined}
                onDrop={onReorderPanes ? (e) => handleDrop(e, agentId) : undefined}
                onDragEnd={onReorderPanes ? handleDragEnd : undefined}
                onDragLeave={onReorderPanes ? () => setDragOverId(null) : undefined}
                style={{
                  minWidth: 0,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  overflow: "hidden",
                  borderLeft: `1px solid ${TERM_BORDER}`,
                  borderBottom: ROWS > 1 ? `1px solid ${TERM_BORDER_DIM}` : undefined,
                }}
              >
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
                  autoMerge={data.autoMerge}
                  pendingMerge={data.pendingMerge}
                  lastMergeCommit={data.lastMergeCommit}
                  lastMergeMessage={data.lastMergeMessage}
                  onMerge={onMerge ? () => onMerge(agentId) : undefined}
                  onRevert={onRevert ? () => onRevert(agentId) : undefined}
                  onUndoMerge={onUndoMerge ? () => onUndoMerge(agentId) : undefined}
                  scrollFrozen={scrollFrozen}
                />
              </div>
            );
          }

          // Placeholder slot
          const { index: pi } = slot;
          return (
            <div
              key={`placeholder-${pi}`}
              className="mpv-placeholder"
              style={{
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                position: "relative",
                borderLeft: `1px solid ${TERM_BORDER_DIM}`,
                borderBottom: ROWS > 1 ? `1px solid ${TERM_BORDER_DIM}` : undefined,
              }}
            >
              {pi === hireSlotIndex && onHire && (
                <button
                  onClick={onHire}
                  title="Hire an agent"
                  aria-label="Hire an agent"
                  className="mpv-placeholder-hire"
                >
                  <span className="mpv-placeholder-hire-icon">+</span>
                </button>
              )}

            </div>
          );
        })}
      </div>

      {/* Bottom bar: page dots */}
      <div className="term-info-bar flex justify-center items-center px-3 py-1.5 font-mono text-[11px] text-muted-foreground bg-term-panel shrink-0 relative gap-2 border-t border-term-border-dim shadow-[0_-3px_8px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]">

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
