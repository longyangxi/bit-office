import { memo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { AgentPaneProps, ReviewerOverlayData } from "./AgentPane";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_PANEL, TERM_BORDER_DIM, TERM_BORDER, TERM_TEXT_BRIGHT, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_BG, TERM_SURFACE, TERM_HOVER } from "./termTheme";

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
  onApplyReviewFixes?: () => void;
  onDismissReview?: () => void;
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
      {/* Inline avatar header for this pane */}
      {meta && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          background: TERM_PANEL,
          borderBottom: `1px solid ${TERM_BORDER_DIM}`,
          flexShrink: 0,
        }}>
          <div style={{ position: "relative", width: 24, height: 28, overflow: "hidden", borderRadius: 2, flexShrink: 0 }}>
            <div style={{ marginTop: -1 }}>
              <SpriteAvatar palette={meta.palette} zoom={1.5} ready={assetsReady ?? false} />
            </div>
            {data.busy && (
              <span style={{
                position: "absolute", top: 0, right: 0,
                width: 5, height: 5, borderRadius: "50%",
                backgroundColor: TERM_GREEN, boxShadow: `0 0 4px ${TERM_GREEN}`,
                animation: "px-pulse-gold 1.5s ease infinite",
              }} />
            )}
            {meta.isTeamLead && (
              <span style={{ position: "absolute", top: -2, left: -1, fontSize: 7, color: TERM_SEM_YELLOW }}>{"\u2605"}</span>
            )}
          </div>
          <span style={{
            fontSize: 11, color: TERM_TEXT_BRIGHT,
            fontFamily: TERM_FONT, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{meta.name}</span>
        </div>
      )}
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
        scrollFrozen={scrollFrozen}
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
  onApplyReviewFixes?: () => void;
  onDismissReview?: () => void;
  /** Freeze scroll management during CSS width transitions */
  scrollFrozen?: boolean;
  /** Agent metadata for inline avatar headers (console mode) */
  agentMeta?: { agentId: string; name: string; palette: number; isTeamLead: boolean }[];
  assetsReady?: boolean;
  /** Show hire/create button after last pane */
  showHireButton?: boolean;
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
    onHire,
    showTeamControls,
    teamBusy,
    onStopTeam,
    onFireTeam,
  } = props;

  const visiblePanes = openPanes.slice(paneOffset, paneOffset + MAX_VISIBLE);
  const maxOffset = Math.max(0, openPanes.length - MAX_VISIBLE);
  const totalPages = Math.ceil(openPanes.length / MAX_VISIBLE);
  const currentPage = Math.floor(paneOffset / MAX_VISIBLE) + 1;

  // Check if trailing controls should show (team controls only — hire button moved to pagination bar)
  // Only show in last page of pagination (or when no pagination)
  const isLastPage = paneOffset + MAX_VISIBLE >= openPanes.length;
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
            title="Hire Team"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 10, padding: "28px 48px",
              border: `1px solid ${TERM_SEM_YELLOW}30`, borderRadius: 6, cursor: "pointer",
              backgroundColor: `${TERM_SEM_YELLOW}06`, color: TERM_SEM_YELLOW,
              fontSize: 13, fontFamily: TERM_FONT,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}12`; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}60`; e.currentTarget.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}06`; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}30`; e.currentTarget.style.transform = "scale(1)"; }}
          >
            <span style={{ fontSize: 22, opacity: 0.8 }}>+</span>
            <span style={{ letterSpacing: "0.5px" }}>Hire Team</span>
          </button>
        ) : (
          "No agents active"
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Panes row */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {visiblePanes.map((agentId, i) => {
          const data = getAgentData(agentId);
          if (!data) return null;
          const meta = agentMeta?.find(m => m.agentId === agentId);
          return (
            <div
              key={agentId}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                borderLeft: i > 0 ? `1px solid rgba(24,255,98,0.1)` : undefined,
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
                scrollFrozen={scrollFrozen}
              />
            </div>
          );
        })}

        {/* Trailing team controls (stop/fire) after last pane */}
        {hasTrailingControls && (
          <div
            style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 8, padding: "0 16px",
              borderLeft: visiblePanes.length > 0 ? `1px solid rgba(24,255,98,0.1)` : undefined,
              minWidth: 60, flexShrink: 0,
            }}
          >
            {showTeamControls && teamBusy && onStopTeam && (
              <button
                onClick={onStopTeam}
                title="Stop Team Work"
                style={{
                  padding: "6px 12px",
                  border: `1px solid ${TERM_SEM_YELLOW}60`, cursor: "pointer",
                  backgroundColor: `${TERM_SEM_YELLOW}15`, color: TERM_SEM_YELLOW,
                  fontSize: 10, fontFamily: TERM_FONT,
                }}
              >stop</button>
            )}
            {showTeamControls && onFireTeam && (
              <button
                onClick={onFireTeam}
                title="Fire Team"
                style={{
                  padding: "6px 12px",
                  border: `1px solid ${TERM_SEM_RED}30`, cursor: "pointer",
                  backgroundColor: "transparent", color: TERM_SEM_RED,
                  fontSize: 10, fontFamily: TERM_FONT,
                  transition: "all 0.15s", opacity: 0.7,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.backgroundColor = `${TERM_SEM_RED}15`; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.backgroundColor = "transparent"; }}
              >fire</button>
            )}
          </div>
        )}
      </div>

      {/* Pagination bar — always visible so layout stays stable */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "6px 12px",
          fontFamily: TERM_FONT,
          fontSize: TERM_SIZE - 1,
          color: TERM_DIM,
          background: TERM_PANEL,
          borderTop: `1px solid ${TERM_BORDER_DIM}`,
          flexShrink: 0,
          position: "relative",
          gap: 8,
        }}
      >
        {/* Center: pagination controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => onPaneOffsetChange(Math.max(0, paneOffset - 1))}
            disabled={paneOffset === 0}
            aria-label="Previous panes"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26,
              background: paneOffset === 0 ? "transparent" : TERM_SURFACE,
              border: `1px solid ${paneOffset === 0 ? "transparent" : TERM_BORDER_DIM}`,
              borderRadius: 4,
              color: paneOffset === 0 ? TERM_DIM : TERM_GREEN,
              cursor: paneOffset === 0 ? "default" : "pointer",
              fontFamily: TERM_FONT,
              fontSize: 10,
              padding: 0,
              opacity: paneOffset === 0 ? 0.35 : 1,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (paneOffset > 0) { e.currentTarget.style.background = TERM_HOVER; e.currentTarget.style.borderColor = TERM_BORDER; } }}
            onMouseLeave={(e) => { if (paneOffset > 0) { e.currentTarget.style.background = TERM_SURFACE; e.currentTarget.style.borderColor = TERM_BORDER_DIM; } }}
          >
            ◀
          </button>

          {/* Page dots */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 6px" }}>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => onPaneOffsetChange(i * MAX_VISIBLE)}
                aria-label={`Page ${i + 1}`}
                style={{
                  width: currentPage === i + 1 ? 14 : 6,
                  height: 6,
                  borderRadius: 3,
                  border: "none",
                  padding: 0,
                  background: currentPage === i + 1 ? TERM_GREEN : `${TERM_DIM}60`,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  opacity: currentPage === i + 1 ? 1 : 0.6,
                }}
              />
            ))}
          </div>

          <button
            onClick={() => onPaneOffsetChange(Math.min(maxOffset, paneOffset + 1))}
            disabled={paneOffset >= maxOffset}
            aria-label="Next panes"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26,
              background: paneOffset >= maxOffset ? "transparent" : TERM_SURFACE,
              border: `1px solid ${paneOffset >= maxOffset ? "transparent" : TERM_BORDER_DIM}`,
              borderRadius: 4,
              color: paneOffset >= maxOffset ? TERM_DIM : TERM_GREEN,
              cursor: paneOffset >= maxOffset ? "default" : "pointer",
              fontFamily: TERM_FONT,
              fontSize: 10,
              padding: 0,
              opacity: paneOffset >= maxOffset ? 0.35 : 1,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (paneOffset < maxOffset) { e.currentTarget.style.background = TERM_HOVER; e.currentTarget.style.borderColor = TERM_BORDER; } }}
            onMouseLeave={(e) => { if (paneOffset < maxOffset) { e.currentTarget.style.background = TERM_SURFACE; e.currentTarget.style.borderColor = TERM_BORDER_DIM; } }}
          >
            ▶
          </button>
        </div>

        {/* Right: hire team button */}
        {showHireButton && onHire && (
          <button
            onClick={onHire}
            title="Hire Team"
            aria-label="Hire Team"
            style={{
              position: "absolute",
              right: 10,
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px",
              height: 26,
              border: `1px solid ${TERM_SEM_YELLOW}35`,
              borderRadius: 4,
              cursor: "pointer",
              backgroundColor: `${TERM_SEM_YELLOW}08`,
              color: TERM_SEM_YELLOW,
              fontSize: 11, fontFamily: TERM_FONT,
              transition: "all 0.15s",
              whiteSpace: "nowrap" as const,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}18`; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}70`; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}08`; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}35`; }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
            <span style={{ opacity: 0.85 }}>hire</span>
          </button>
        )}
      </div>
    </div>
  );
});

export default MultiPaneView;
