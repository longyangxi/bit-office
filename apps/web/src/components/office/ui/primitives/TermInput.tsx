"use client";

import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface TermInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Render as inline (borderless, transparent) terminal-style input */
  inline?: boolean;
}

export interface TermTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Render as inline (borderless, transparent) terminal-style input */
  inline?: boolean;
}

const inlineClasses =
  "border-none bg-transparent text-term-text-bright caret-accent px-1.5 py-1.5 focus:border-none focus:shadow-none";

/**
 * TermInput -- Wrapper around shadcn Input with terminal styling.
 * Drop-in replacement: same API.
 *
 * Usage:
 *   <TermInput placeholder="Search..." value={q} onChange={...} />
 *   <TermInput inline placeholder="type here..." />
 */
const TermInput = forwardRef<HTMLInputElement, TermInputProps>(function TermInput(
  { inline, className, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      className={cn(inline && inlineClasses, className)}
      {...props}
    />
  );
});

/**
 * TermTextArea -- Wrapper around shadcn Textarea with terminal styling.
 *
 * Usage:
 *   <TermTextArea rows={1} placeholder="message..." />
 *   <TermTextArea inline rows={1} />
 */
const TermTextArea = forwardRef<HTMLTextAreaElement, TermTextAreaProps>(function TermTextArea(
  { inline, className, ...props },
  ref,
) {
  return (
    <Textarea
      ref={ref}
      className={cn(
        !inline && "overflow-hidden",
        inline && inlineClasses,
        className,
      )}
      {...props}
    />
  );
});

export { TermTextArea };
export default TermInput;
