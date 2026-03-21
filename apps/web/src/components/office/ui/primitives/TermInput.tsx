"use client";

import { forwardRef } from "react";

export interface TermInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Render as inline (borderless, transparent) terminal-style input */
  inline?: boolean;
}

export interface TermTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Render as inline (borderless, transparent) terminal-style input */
  inline?: boolean;
}

/**
 * TermInput -- CSS-class-based <input> for the terminal UI.
 * Focus states handled in CSS. Consistent sizing with lineHeight: 20px.
 *
 * Usage:
 *   <TermInput placeholder="Search..." value={q} onChange={...} />
 *   <TermInput inline placeholder="type here..." />
 */
const TermInput = forwardRef<HTMLInputElement, TermInputProps>(function TermInput(
  { inline, className, ...props },
  ref,
) {
  const cls = ["ti", inline && "ti-inline", className].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} {...props} />;
});

/**
 * TermTextArea -- CSS-class-based <textarea> for the terminal UI.
 * Uses ti + ti-textarea classes for consistent styling.
 *
 * Usage:
 *   <TermTextArea rows={1} placeholder="message..." />
 *   <TermTextArea inline rows={1} />
 */
const TermTextArea = forwardRef<HTMLTextAreaElement, TermTextAreaProps>(function TermTextArea(
  { inline, className, ...props },
  ref,
) {
  const cls = ["ti", !inline && "ti-textarea", inline && "ti-inline", className].filter(Boolean).join(" ");
  return <textarea ref={ref} className={cls} {...props} />;
});

export { TermTextArea };
export default TermInput;
