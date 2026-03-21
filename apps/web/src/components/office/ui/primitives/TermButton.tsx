"use client";

import { forwardRef } from "react";

export type TermButtonVariant = "ghost" | "primary" | "danger" | "success" | "warning" | "dim";

export interface TermButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TermButtonVariant;
}

const variantClass: Record<TermButtonVariant, string> = {
  ghost: "tb-ghost",
  primary: "tb-primary",
  danger: "tb-danger",
  success: "tb-success",
  warning: "tb-warning",
  dim: "tb-dim",
};

/**
 * TermButton -- CSS-class-based button for the terminal UI.
 *
 * Hover/focus states handled entirely in CSS (primitives.css).
 * No onMouseEnter/onMouseLeave JS required.
 *
 * Usage:
 *   <TermButton variant="primary" onClick={handleClick}>approve</TermButton>
 *   <TermButton variant="danger" onClick={handleDelete}>fire</TermButton>
 *   <TermButton onClick={handleCancel}>cancel</TermButton>  // defaults to ghost
 */
const TermButton = forwardRef<HTMLButtonElement, TermButtonProps>(function TermButton(
  { variant = "ghost", className, ...props },
  ref,
) {
  const cls = ["tb", variantClass[variant], className].filter(Boolean).join(" ");
  return <button ref={ref} className={cls} {...props} />;
});

export default TermButton;
