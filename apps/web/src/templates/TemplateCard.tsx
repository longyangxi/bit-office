"use client";

import type { ProjectTemplate } from "./templates";
import { TERM_SIZE_2XS, TERM_SIZE_XS } from "@/components/office/ui/termTheme";

const ICON_MAP: Record<string, string> = {
  globe: "\u{1F310}",
  terminal: "\u{1F4BB}",
  server: "\u{1F5A5}\uFE0F",
  puzzle: "\u{1F9E9}",
  "file-text": "\u{1F4C4}",
};

interface TemplateCardProps {
  template: ProjectTemplate;
  selected: boolean;
  onClick: () => void;
}

export default function TemplateCard({ template, selected, onClick }: TemplateCardProps) {
  return (
    <button
      className={`tac${selected ? " tac-selected" : ""}`}
      onClick={onClick}
      style={{ padding: "var(--space-3)", alignItems: "flex-start", gap: "var(--space-1)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%" }}>
        <span style={{ fontSize: 16 }}>{ICON_MAP[template.icon] ?? "\u{1F4E6}"}</span>
        <span
          style={{
            fontSize: "var(--font-size-base)",
            fontFamily: "var(--font-mono)",
            color: selected ? "var(--term-accent)" : "var(--term-text-bright)",
            fontWeight: 600,
          }}
        >
          {template.name}
        </span>
      </div>
      <span
        style={{
          fontSize: TERM_SIZE_XS,
          fontFamily: "var(--font-mono)",
          color: "var(--term-text)",
          opacity: 0.7,
          textAlign: "left",
        }}
      >
        {template.description}
      </span>
      <span
        style={{
          fontSize: TERM_SIZE_2XS,
          fontFamily: "var(--font-mono)",
          color: "var(--term-dim)",
          textAlign: "left",
        }}
      >
        {template.suggestedRoles.join(" + ")}
      </span>
    </button>
  );
}
