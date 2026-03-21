"use client";

import { useEffect, useRef, useCallback } from "react";

export interface TermModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Called when user requests close (backdrop click, Escape key) */
  onClose: () => void;
  /** Optional: max-width override (default 420px via CSS) */
  maxWidth?: number;
  /** Optional: custom z-index */
  zIndex?: number;
  /** Modal title shown in header. Omit to hide header. */
  title?: string;
  /** Content rendered in modal body */
  children: React.ReactNode;
  /** Content rendered in modal footer (buttons). Omit to hide footer. */
  footer?: React.ReactNode;
  /** Additional className on the container */
  className?: string;
  /** ARIA role override (default: "dialog") */
  role?: string;
}

/**
 * TermModal -- Accessible modal with focus trap, Escape-to-close,
 * backdrop click, and CSS-driven animations.
 *
 * Usage:
 *   <TermModal open={show} onClose={() => setShow(false)} title="Confirm">
 *     <p>Are you sure?</p>
 *     <TermModal.Footer>
 *       <TermButton onClick={...}>Yes</TermButton>
 *     </TermModal.Footer>
 *   </TermModal>
 *
 * Or with footer prop:
 *   <TermModal open={show} onClose={close} title="Fire Agent" footer={<>...</>}>
 *     Are you sure you want to fire this agent?
 *   </TermModal>
 */
export default function TermModal({
  open,
  onClose,
  maxWidth,
  zIndex,
  title,
  children,
  footer,
  className,
  role = "dialog",
}: TermModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Focus trap + restore focus on close
  useEffect(() => {
    if (!open) return;

    // Save previous focus
    previousFocus.current = document.activeElement as HTMLElement;

    // Focus the container (or first focusable element)
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (focusable || container).focus();
    }, 50);

    return () => {
      clearTimeout(timer);
      // Restore previous focus on unmount
      previousFocus.current?.focus();
    };
  }, [open]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      // Focus trap: Tab wrapping
      if (e.key === "Tab") {
        const container = containerRef.current;
        if (!container) return;
        const focusables = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="tm-backdrop"
      onClick={handleBackdropClick}
      role={role}
      aria-modal="true"
      aria-label={title}
      style={zIndex ? { zIndex } : undefined}
    >
      <div
        ref={containerRef}
        className={["tm-container", className].filter(Boolean).join(" ")}
        style={maxWidth ? { maxWidth } : undefined}
        tabIndex={-1}
      >
        {title && (
          <div className="tm-header">
            <span>{title}</span>
            <button className="tm-close" onClick={onClose} aria-label="Close">&times;</button>
          </div>
        )}
        <div className="tm-body">
          {children}
        </div>
        {footer && (
          <div className="tm-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
