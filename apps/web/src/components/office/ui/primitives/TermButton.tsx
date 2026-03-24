"use client";

import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TermButtonVariant = "ghost" | "primary" | "danger" | "success" | "warning" | "dim";

export interface TermButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TermButtonVariant;
}

/**
 * TermButton -- Wrapper around shadcn Button with terminal theme variants.
 * Drop-in replacement: same API, backed by CVA + Tailwind.
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
  return (
    <Button
      ref={ref}
      variant={variant as ButtonProps["variant"]}
      className={cn(className)}
      {...props}
    />
  );
});

export default TermButton;
