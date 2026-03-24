"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[10000] bg-black/65",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    maxWidth?: number;
    /** z-index applied to BOTH overlay and content as a pair */
    zIndex?: number;
  }
>(({ className, children, maxWidth, zIndex, style, ...props }, ref) => {
  // Compute z-indices: overlay at base, content at base+1
  const overlayZ = zIndex ?? 10000;
  const contentZ = overlayZ + 1;
  return (
    <DialogPortal>
      <DialogOverlay style={{ zIndex: overlayZ }} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "w-[90%] max-w-[520px] max-h-[90vh]",
          "bg-term-panel border-[1.5px] border-term-green-dim shadow-xl",
          "flex flex-col overflow-hidden",
          "font-mono text-term text-foreground",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]",
          className
        )}
        style={{ zIndex: contentZ, ...(maxWidth ? { maxWidth } : {}), ...style }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "px-4 py-3 flex items-center justify-between shrink-0",
      "font-mono text-term text-term-text-bright",
      "shadow-[0_3px_6px_-2px_rgba(0,0,0,0.4),inset_0_-1px_0_var(--separator-groove-dark),var(--highlight-top)]",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "p-4 overflow-y-auto flex-1 min-h-0",
      "font-mono text-term text-foreground leading-[1.7]",
      className
    )}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "px-4 py-3 flex items-center justify-center gap-2 shrink-0",
      "shadow-[0_-3px_6px_-2px_rgba(0,0,0,0.35),inset_0_1px_0_var(--separator-groove-light)]",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-mono text-term text-term-text-bright", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-term text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
