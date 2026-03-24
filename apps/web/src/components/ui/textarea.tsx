import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex w-full px-2.5 py-1.5 resize-none",
        "border border-border bg-background text-foreground",
        "font-mono text-term leading-5",
        "outline-none transition-colors duration-fast",
        "placeholder:text-term-green-dim placeholder:opacity-50",
        "focus:border-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
