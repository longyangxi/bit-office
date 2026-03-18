import { memo } from "react";
import dynamic from "next/dynamic";
import type { AgentPaneProps, ReviewerOverlayData } from "./AgentPane";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_PANEL } from "./termTheme";

const AgentPane = dynamic(() => import("./AgentPane"), { ssr: false });

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
  } = props;

  const visiblePanes = openPanes.slice(paneOffset, paneOffset + MAX_VISIBLE);
  const maxOffset = Math.max(0, openPanes.length - MAX_VISIBLE);
  const totalPages = Math.ceil(openPanes.length / MAX_VISIBLE);
  const currentPage = Math.floor(paneOffset / MAX_VISIBLE) + 1;

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
        Click agents to open chat panes
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
