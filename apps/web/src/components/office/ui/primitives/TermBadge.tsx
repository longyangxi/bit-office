"use client";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TermBadgeVariant = "green" | "yellow" | "red" | "blue" | "purple" | "dim";

export interface TermBadgeProps {
  variant?: TermBadgeVariant;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * TermBadge -- Wrapper around shadcn Badge with terminal semantic colors.
 * Drop-in replacement: same API.
 *
 * Usage:
 *   <TermBadge variant="green">Done</TermBadge>
 *   <TermBadge variant="yellow">LEAD</TermBadge>
 *   <TermBadge variant="blue">Working</TermBadge>
 */
export default function TermBadge({
  variant = "dim",
  children,
  className,
  style,
}: TermBadgeProps) {
  return (
    <Badge
      variant={variant as BadgeProps["variant"]}
      className={cn(className)}
      style={style}
    >
      {children}
    </Badge>
  );
}
