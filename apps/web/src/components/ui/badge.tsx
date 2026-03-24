import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-1.5 py-px font-mono text-[10px] font-medium tracking-wide whitespace-nowrap leading-snug border",
  {
    variants: {
      variant: {
        green: "text-sem-green bg-sem-green/8 border-sem-green/25",
        yellow: "text-sem-yellow bg-sem-yellow/8 border-sem-yellow/25",
        red: "text-sem-red bg-sem-red/8 border-sem-red/25",
        blue: "text-sem-blue bg-sem-blue/8 border-sem-blue/25",
        purple: "text-sem-purple bg-sem-purple/8 border-sem-purple/25",
        dim: "text-term-green-dim bg-term-green-dim/8 border-term-green-dim/20",
      },
    },
    defaultVariants: {
      variant: "dim",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
