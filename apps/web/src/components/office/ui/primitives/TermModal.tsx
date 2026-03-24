"use client";

import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
 * TermModal -- Accessible modal backed by Radix Dialog.
 * Drop-in replacement: same props API, powered by shadcn Dialog.
 *
 * Usage:
 *   <TermModal open={show} onClose={() => setShow(false)} title="Confirm">
 *     <p>Are you sure?</p>
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
}: TermModalProps) {
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) onClose();
    },
    [onClose]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        maxWidth={maxWidth}
        className={cn(className)}
        zIndex={zIndex ?? undefined}
      >
        {title && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <button
              className="px-2 py-0.5 border border-border bg-transparent text-muted-foreground font-mono text-term cursor-pointer leading-none transition-colors duration-fast hover:text-foreground hover:border-term-text-bright"
              onClick={onClose}
              aria-label="Close"
            >
              &times;
            </button>
          </DialogHeader>
        )}
        {/* Hidden description for accessibility when no visible description */}
        <DialogDescription className="sr-only">
          {title ? `${title} dialog` : "Dialog"}
        </DialogDescription>
        <DialogBody>{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
