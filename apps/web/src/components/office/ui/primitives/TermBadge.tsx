"use client";

export type TermBadgeVariant = "green" | "yellow" | "red" | "blue" | "purple" | "dim";

export interface TermBadgeProps {
  variant?: TermBadgeVariant;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const variantClass: Record<TermBadgeVariant, string> = {
  green: "tg-green",
  yellow: "tg-yellow",
  red: "tg-red",
  blue: "tg-blue",
  purple: "tg-purple",
  dim: "tg-dim",
};

/**
 * TermBadge -- Small status/label badge with semantic color variants.
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
  const cls = ["tg", variantClass[variant], className].filter(Boolean).join(" ");
  return <span className={cls} style={style}>{children}</span>;
}
