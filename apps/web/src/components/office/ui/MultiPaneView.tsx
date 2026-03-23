import { memo, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { AgentPaneProps, ReviewerOverlayData } from "./AgentPane";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_PANEL, TERM_BORDER_DIM, TERM_BORDER, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_BLUE, TERM_SEM_GREEN, TERM_BG, TERM_SURFACE, TERM_HOVER } from "./termTheme";
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
        autoMerge={data.autoMerge}
        pendingMerge={data.pendingMerge}
        lastMergeCommit={data.lastMergeCommit}
        lastMergeMessage={data.lastMergeMessage}
        onMerge={onMerge ? () => onMerge(agentId) : undefined}
        onRevert={onRevert ? () => onRevert(agentId) : undefined}
        onUndoMerge={onUndoMerge ? () => onUndoMerge(agentId) : undefined}
        onApplyReviewFixes={onApplyReviewFixes}
        onDismissReview={onDismissReview}
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

  // ── Scroll-snap pagination ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always start on page 0 when component mounts (e.g. fullscreen open)
  const [currentPage, setCurrentPage] = useState(0);
  // Guard: skip scroll events caused by programmatic scrollTo
  // Use a counter so nested/overlapping programmatic scrolls are safe
  const programmaticScrollRef = useRef(0);
  const mountedRef = useRef(false);
  // Track internally-set offset to break goToPage→paneOffset effect loop
  const internalOffsetRef = useRef<number | null>(null);

  // ── Pane resize logic (within a page) ──
  const [paneWidths, setPaneWidths] = useState<number[]>([]);
  const dragRef = useRef<{ index: number; startX: number; startWidths: number[]; containerW: number } | null>(null);

  const totalPages = Math.ceil(openPanes.length / MAX_VISIBLE);

  // Build pages: each page holds up to MAX_VISIBLE panes
  const pages: string[][] = [];
  for (let i = 0; i < openPanes.length; i += MAX_VISIBLE) {
    pages.push(openPanes.slice(i, i + MAX_VISIBLE));
  }

  // Scroll viewport to a target page (shared helper)
  // Uses "instant" behavior to avoid race conditions with scroll-snap.
  // scroll-snap: x mandatory already provides visual snapping, so smooth
  // JS scrolling fights with it and causes snap-back bugs.
  const scrollToPage = useCallback((page: number, _smooth?: boolean) => {
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0) return;
    const targetScroll = page * vp.clientWidth;
    if (Math.abs(vp.scrollLeft - targetScroll) <= 2) return;
    programmaticScrollRef.current += 1;
    vp.scrollTo({ left: targetScroll, behavior: "instant" as ScrollBehavior });
    // Clear guard after layout settles (instant scroll = 1-2 frames)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = Math.max(0, programmaticScrollRef.current - 1);
      });
    });
  }, []);

  // On mount: always scroll to page 0 and reset parent offset
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    // Always start at first page when entering console/fullscreen mode
    setCurrentPage(0);
    internalOffsetRef.current = 0;
    onPaneOffsetChange(0);
    requestAnimationFrame(() => scrollToPage(0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to page when paneOffset changes from parent (after mount)
  // Skip when the change originated internally (goToPage already scrolled)
  useEffect(() => {
    if (!mountedRef.current) return;
    if (totalPages <= 1) return;
    // If this offset was set by goToPage, skip the redundant scroll
    if (internalOffsetRef.current === paneOffset) {
      internalOffsetRef.current = null;
      return;
    }
    internalOffsetRef.current = null;
    const targetPage = Math.max(0, Math.min(Math.floor(paneOffset / MAX_VISIBLE), totalPages - 1));
    setCurrentPage(targetPage);
    scrollToPage(targetPage);
  }, [paneOffset, totalPages, scrollToPage]);

  // Detect page from user scroll (debounced), skip programmatic scrolls
  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current > 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (programmaticScrollRef.current > 0) return;
      const vp = viewportRef.current;
      if (!vp || vp.clientWidth === 0) return;
      const page = Math.round(vp.scrollLeft / vp.clientWidth);
      const clamped = Math.max(0, Math.min(page, totalPages - 1));
      setCurrentPage(clamped);
      const newOffset = clamped * MAX_VISIBLE;
      internalOffsetRef.current = newOffset; // prevent paneOffset effect feedback
      onPaneOffsetChange(newOffset);
    }, 80);
  }, [totalPages, onPaneOffsetChange]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Navigate to a specific page (dots, arrows, etc.)
  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    scrollToPage(page);
    const newOffset = page * MAX_VISIBLE;
    internalOffsetRef.current = newOffset; // prevent paneOffset effect from double-scrolling
    onPaneOffsetChange(newOffset);
  }, [onPaneOffsetChange, scrollToPage]);

  // Keyboard navigation: left/right arrow keys to switch pages
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't hijack arrows when user is in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (totalPages <= 1) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPage(Math.max(0, currentPage - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToPage(Math.min(totalPages - 1, currentPage + 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, totalPages, goToPage]);

  // Pane resize within a page
  const startResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    // Find the page container for the current page
    const vp = viewportRef.current;
    if (!vp) return;
    const pageEl = vp.children[currentPage] as HTMLElement | undefined;
    if (!pageEl) return;
    const containerW = pageEl.getBoundingClientRect().width;
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
              gap: 6, padding: "12px 28px",
              border: `1px dashed ${TERM_BORDER}`, cursor: "pointer",
              backgroundColor: "transparent", color: TERM_DIM,
              fontSize: 11, fontFamily: TERM_FONT,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_GREEN}0a`; e.currentTarget.style.borderColor = TERM_GREEN; e.currentTarget.style.color = TERM_GREEN; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = TERM_BORDER; e.currentTarget.style.color = TERM_DIM; }}
          >
            <span style={{ fontSize: 14, lineHeight: "1" }}>+</span> {hireLabel}
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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Scroll-snap viewport */}
      <div
        ref={viewportRef}
        className="mpv-viewport"
        onScroll={handleScroll}
      >
        {pages.map((pagePanes, pageIdx) => (
          <div key={pageIdx} className="mpv-page">
            {pagePanes.map((agentId, i) => {
              const data = getAgentData(agentId);
              if (!data) return null;
              const meta = agentMeta?.find(m => m.agentId === agentId);
              // Only apply resize flex on current page
              const isCurrentPage = pageIdx === currentPage;
              const flex = isCurrentPage && flexValues[i] != null
                ? `${flexValues[i]} 1 0%` : "1 1 0%";
              return (
                <div key={agentId} style={{ display: "contents" }}>
                  {/* Resize handle between panes */}
                  {i > 0 && isCurrentPage && (
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
                    {/* Floating hire button on last pane of last page */}
                    {showHireButton && onHire && pageIdx === pages.length - 1 && i === pagePanes.length - 1 && (
                      <button
                        onClick={onHire}
                        title="Hire"
                        aria-label="Hire"
                        className="mpv-hire-float"
                      >
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
            {pageIdx === pages.length - 1 && hasTrailingControls && (
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
        ))}
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
