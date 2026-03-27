import { useRef, useEffect, useState } from "react";
import { TERM_ACCENT, TERM_PANEL } from "./termTheme";
import { TermButton, TermInput } from "./primitives";

/** Review footer with feedback input + action buttons */
export function ReviewFooter({ onApplyReviewFixes, onDismissReview }: {
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
      background: `color-mix(in srgb, ${TERM_ACCENT} 5%, ${TERM_PANEL})`,
      boxShadow: `inset 0 1px 0 ${TERM_ACCENT}10`,
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
