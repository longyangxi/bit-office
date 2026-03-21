"use client";

/**
 * TermEmpty — terminal-styled empty state placeholder.
 *
 * Usage:
 *   <TermEmpty message="No agents online" hint="hire your first agent" />
 *   <TermEmpty message="Waiting for output..." />
 */
export interface TermEmptyProps {
  message: string;
  hint?: string;
  className?: string;
}

export default function TermEmpty({ message, hint, className }: TermEmptyProps) {
  const cls = ["te", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className="te-msg">{message}</span>
      {hint && <span className="te-hint">{hint}</span>}
    </div>
  );
}
