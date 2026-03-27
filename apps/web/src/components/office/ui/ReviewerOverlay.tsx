import { TERM_FONT, TERM_SIZE, TERM_SIZE_3XS, TERM_ACCENT, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_BG, TERM_PANEL, TERM_BORDER, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme";
import { TokenBadge, MdContent } from "./MessageBubble";
import { MatrixRainCanvas } from "./MatrixRainCanvas";
import { ReviewFooter } from "./ReviewFooter";
import { LoadMoreSentinel } from "./LoadMoreSentinel";
import type { ReviewerOverlayData } from "./AgentPane";
import type React from "react";
import dynamic from "next/dynamic";

const MessageBubble = dynamic(() => import("./MessageBubble"), { ssr: false });

export interface ReviewerOverlayProps {
  reviewerOverlay: ReviewerOverlayData;
  reviewChatEndRef: React.RefObject<HTMLDivElement | null>;
  onApplyReviewFixes?: (userFeedback?: string) => void;
  onDismissReview?: () => void;
  onReviewerLoadMore?: () => void;
}

export function ReviewerOverlay({
  reviewerOverlay,
  reviewChatEndRef,
  onApplyReviewFixes,
  onDismissReview,
  onReviewerLoadMore,
}: ReviewerOverlayProps) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      display: "flex", flexDirection: "column",
      background: `color-mix(in srgb, ${TERM_ACCENT} 4%, ${TERM_BG})`,
      animation: "review-overlay-in 0.3s ease-out",
      overflow: "hidden",
    }}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 14px",
        background: `color-mix(in srgb, ${TERM_ACCENT} 6%, ${TERM_PANEL})`,
        boxShadow: `inset 0 -1px 0 ${TERM_ACCENT}15`,
        fontSize: TERM_SIZE, fontFamily: TERM_FONT,
        flexShrink: 0,
      }}>
        <span style={{ color: TERM_ACCENT, fontSize: TERM_SIZE_3XS, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `${TERM_ACCENT}18`, letterSpacing: "0.04em", textTransform: "uppercase" }}>REVIEW</span>
        <span style={{ color: TERM_TEXT_BRIGHT }}>
          {reviewerOverlay.name}
        </span>
        {/* Scanning indicator (busy) */}
        {reviewerOverlay.busy && (
          <span className="working-dots" style={{ color: TERM_ACCENT }}>
            <span className="working-dots-mid" />
          </span>
        )}
        {/* Verdict badge (done) */}
        {!reviewerOverlay.busy && reviewerOverlay.verdict && reviewerOverlay.verdict !== "UNKNOWN" && (
          <span style={{
            fontSize: TERM_SIZE_3XS, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
            letterSpacing: "0.04em", textTransform: "uppercase",
            color: reviewerOverlay.verdict === "PASS" ? TERM_SEM_GREEN : TERM_SEM_RED,
            background: reviewerOverlay.verdict === "PASS" ? `${TERM_SEM_GREEN}18` : `${TERM_SEM_RED}18`,
          }}>{reviewerOverlay.verdict}</span>
        )}
        {!reviewerOverlay.busy && reviewerOverlay.status === "error" && (
          <span style={{ color: TERM_SEM_RED, fontSize: TERM_SIZE_3XS, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `${TERM_SEM_RED}18`, letterSpacing: "0.04em", textTransform: "uppercase" }}>ERROR</span>
        )}
        <span style={{ flex: 1 }} />
        {reviewerOverlay.tokenUsage.inputTokens > 0 && (
          <TokenBadge inputTokens={reviewerOverlay.tokenUsage.inputTokens} outputTokens={reviewerOverlay.tokenUsage.outputTokens} cacheReadTokens={reviewerOverlay.tokenUsage.cacheReadTokens} cacheWriteTokens={reviewerOverlay.tokenUsage.cacheWriteTokens} costUsd={reviewerOverlay.tokenUsage.costUsd} />
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

      {/* Body: scanning animation (busy) or results (done) */}
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
            backgroundImage: `linear-gradient(${TERM_ACCENT} 1px, transparent 1px), linear-gradient(90deg, ${TERM_ACCENT} 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }} />
          {/* Matrix-style falling binary digits — canvas */}
          <MatrixRainCanvas color={TERM_ACCENT} font={TERM_FONT} />
          {/* Sweep line */}
          <div className="review-scan-sweep" style={{
            position: "absolute", left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, transparent, ${TERM_ACCENT}, transparent)`,
            boxShadow: `0 0 20px 4px ${TERM_ACCENT}50, 0 0 60px 8px ${TERM_ACCENT}20`,
            animation: "review-scan-sweep 2.4s ease-in-out infinite",
          }} />
          {/* Glow trail behind sweep */}
          <div className="review-scan-trail" style={{
            position: "absolute", left: 0, right: 0, height: 40,
            background: `linear-gradient(180deg, ${TERM_ACCENT}12, transparent)`,
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
                border: `1.5px solid ${TERM_ACCENT}60`,
                animation: "review-scan-pulse 2s ease-in-out infinite",
              }} />
              <div style={{
                position: "absolute", inset: 8, borderRadius: "50%",
                background: `radial-gradient(circle, ${TERM_ACCENT}30, transparent 70%)`,
                animation: "review-scan-pulse 2s ease-in-out infinite 0.3s",
              }} />
              {/* Center dot */}
              <div style={{
                position: "absolute", top: "50%", left: "50%", width: 4, height: 4,
                marginTop: -2, marginLeft: -2, borderRadius: "50%",
                backgroundColor: TERM_ACCENT,
                boxShadow: `0 0 8px ${TERM_ACCENT}`,
              }} />
            </div>
            <span style={{
              fontFamily: TERM_FONT, fontSize: TERM_SIZE, color: TERM_ACCENT,
              letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500,
              opacity: 0.8,
            }}>
              reviewing
            </span>
          </div>
          {/* Corner brackets — decorative */}
          {[
            { top: 12, left: 12, borderTop: `1px solid ${TERM_ACCENT}30`, borderLeft: `1px solid ${TERM_ACCENT}30` },
            { top: 12, right: 12, borderTop: `1px solid ${TERM_ACCENT}30`, borderRight: `1px solid ${TERM_ACCENT}30` },
            { bottom: 12, left: 12, borderBottom: `1px solid ${TERM_ACCENT}30`, borderLeft: `1px solid ${TERM_ACCENT}30` },
            { bottom: 12, right: 12, borderBottom: `1px solid ${TERM_ACCENT}30`, borderRight: `1px solid ${TERM_ACCENT}30` },
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
  );
}
