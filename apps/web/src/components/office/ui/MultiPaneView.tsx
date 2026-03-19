import { memo } from "react";
import dynamic from "next/dynamic";
import type { AgentPaneProps, ReviewerOverlayData } from "./AgentPane";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_PANEL, TERM_BORDER_DIM, TERM_TEXT_BRIGHT, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_BG } from "./termTheme";

const AgentPane = dynamic(() => import("./AgentPane"), { ssr: false });
const SpriteAvatar = dynamic(() => import("./SpriteAvatar"), { ssr: false });

const MAX_VISIBLE = 3;

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

  // Check if trailing controls should show (hire button or team controls)
  // Only show in last page of pagination (or when no pagination)
  const isLastPage = paneOffset + MAX_VISIBLE >= openPanes.length;
  const hasTrailingControls = isLastPage && (showHireButton || showTeamControls);
  // How many visible panes + trailing slot
  const slotsUsed = visiblePanes.length + (hasTrailingControls ? 0 : 0);

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
            title="Hire Agent"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "24px 40px",
              border: `1px dashed ${TERM_SEM_YELLOW}50`, cursor: "pointer",
              backgroundColor: "transparent", color: TERM_SEM_YELLOW,
              fontSize: 14, fontFamily: TERM_FONT,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}15`; e.currentTarget.style.borderColor = TERM_SEM_YELLOW; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}50`; }}
          >
            <span style={{ fontSize: 24 }}>+</span>
            <span>Hire Agent</span>
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
                onPromptChange={(val) => onPanePromptChange(agentId, val)}
                pendingImages={panePendingImages.get(agentId) || []}
                onPendingImagesChange={(imgs) => onPanePendingImagesChange(agentId, imgs)}
                suggestions={suggestions}
                suggestText={suggestText}
                onSuggestTextChange={onSuggestTextChange}
                onSubmit={() => onSubmit(agentId)}
                onCancel={() => onCancel(agentId)}
                onFire={(id) => onFire(id)}
                onApproval={(approvalId, decision) => onApproval(approvalId, decision)}
                onApprovePlan={() => onApprovePlan(agentId)}
                onQuickApprove={() => onQuickApprove(agentId)}
                onEndProject={() => onEndProject(agentId)}
                onSuggest={onSuggest}
                onPreview={onPreview}
                onReview={onReview ? (result, backend) => onReview(agentId, result, backend) : undefined}
                detectedBackends={detectedBackends}
                onLoadMore={() => onLoadMore(agentId)}
                onPasteImage={(e) => onPasteImage(agentId, e)}
                onPasteText={(e) => onPasteText(agentId, e)}
                onDropImage={(e) => onDropImage(agentId, e)}
                reviewerOverlay={reviewOverlay?.sourceAgentId === agentId && getReviewerData ? getReviewerData(reviewOverlay.reviewerAgentId) : null}
                onReviewerLoadMore={reviewOverlay?.sourceAgentId === agentId && onReviewerLoadMore ? () => onReviewerLoadMore(reviewOverlay.reviewerAgentId) : undefined}
                onApplyReviewFixes={reviewOverlay?.sourceAgentId === agentId ? onApplyReviewFixes : undefined}
                onDismissReview={reviewOverlay?.sourceAgentId === agentId ? onDismissReview : undefined}
                scrollFrozen={scrollFrozen}
              />
            </div>
          );
        })}

        {/* Trailing hire/team controls after last pane */}
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
            {showHireButton && onHire && (
              <button
                onClick={onHire}
                title="Hire Agent"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 44, height: 44,
                  border: `1px dashed ${TERM_SEM_YELLOW}50`, cursor: "pointer",
                  backgroundColor: "transparent", color: TERM_SEM_YELLOW,
                  fontSize: 20, fontFamily: TERM_FONT,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}15`; e.currentTarget.style.borderColor = TERM_SEM_YELLOW; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = `${TERM_SEM_YELLOW}50`; }}
              >+</button>
            )}
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

      {/* Pagination bar */}
      {openPanes.length > MAX_VISIBLE && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            padding: "4px 0",
            fontFamily: TERM_FONT,
            fontSize: TERM_SIZE - 1,
            color: TERM_DIM,
            background: TERM_PANEL,
            borderTop: `1px solid rgba(24,255,98,0.08)`,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => onPaneOffsetChange(Math.max(0, paneOffset - 1))}
            disabled={paneOffset === 0}
            aria-label="Previous panes"
            style={{
              background: "none",
              border: "none",
              color: paneOffset === 0 ? TERM_DIM : TERM_GREEN,
              cursor: paneOffset === 0 ? "default" : "pointer",
              fontFamily: TERM_FONT,
              fontSize: TERM_SIZE,
              padding: "2px 6px",
              opacity: paneOffset === 0 ? 0.4 : 1,
            }}
          >
            ◀
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPaneOffsetChange(Math.min(maxOffset, paneOffset + 1))}
            disabled={paneOffset >= maxOffset}
            aria-label="Next panes"
            style={{
              background: "none",
              border: "none",
              color: paneOffset >= maxOffset ? TERM_DIM : TERM_GREEN,
              cursor: paneOffset >= maxOffset ? "default" : "pointer",
              fontFamily: TERM_FONT,
              fontSize: TERM_SIZE,
              padding: "2px 6px",
              opacity: paneOffset >= maxOffset ? 0.4 : 1,
            }}
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
});

export default MultiPaneView;
