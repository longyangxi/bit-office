"use client";

import type { ProjectTemplate } from "./templates";
import { BUILT_IN_TEMPLATES } from "./templates";
import TemplateCard from "./TemplateCard";
import { TERM_SIZE_XS } from "@/components/office/ui/termTheme";

interface TemplateSelectorProps {
  selected: ProjectTemplate | null;
  onSelect: (t: ProjectTemplate | null) => void;
}

export default function TemplateSelector({ selected, onSelect }: TemplateSelectorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-2)",
        }}
      >
        {BUILT_IN_TEMPLATES.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            selected={selected?.id === t.id}
            onClick={() => onSelect(selected?.id === t.id ? null : t)}
          />
        ))}
      </div>
      <button
        onClick={() => onSelect(null)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: TERM_SIZE_XS,
          color: "var(--term-dim)",
          textDecoration: "underline",
          padding: "var(--space-1) 0",
          textAlign: "center",
        }}
      >
        or start blank
      </button>
    </div>
  );
}
