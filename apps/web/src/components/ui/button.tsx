import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap font-mono text-term transition-all duration-fast shrink-0 cursor-pointer disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        ghost:
          "border border-border bg-transparent text-foreground hover:border-term-text-bright hover:text-term-text-bright hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0 active:shadow-none",
        primary:
          "border border-sem-green text-sem-green hover:bg-sem-green/10 hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0",
        danger:
          "border border-sem-red text-sem-red hover:bg-sem-red/10 hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0",
        success:
          "border border-sem-green text-sem-green hover:bg-sem-green/10 hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0",
        warning:
          "border border-sem-yellow text-sem-yellow hover:bg-sem-yellow/10 hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0",
        dim:
          "border border-border text-muted-foreground hover:text-foreground hover:border-term-text-bright hover:shadow-sm hover:-translate-y-px active:opacity-85 active:translate-y-0",
      },
      size: {
        default: "px-3.5 py-1.5 leading-5",
        sm: "px-2.5 py-1 text-[11px] leading-4",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
