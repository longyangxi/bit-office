import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex w-full px-2.5 py-1 h-7",
        "border border-border bg-background text-foreground",
        "font-mono text-term leading-4",
        "outline-none focus-visible:outline-none transition-colors duration-fast",
        "placeholder:text-term-dim placeholder:opacity-50",
        "focus:border-term-dim",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
