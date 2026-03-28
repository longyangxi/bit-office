"use client";

import type { ProjectTemplate } from "./templates";
import { BUILT_IN_TEMPLATES } from "./templates";
import TemplateCard from "./TemplateCard";
import { TERM_SIZE_2XS } from "@/components/office/ui/termTheme";

interface TemplateSelectorProps {
  selected: ProjectTemplate | null;
  onSelect: (t: ProjectTemplate | null) => void;
}

export default function TemplateSelector({ selected, onSelect }: TemplateSelectorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* Blank Project — prominent button at top */}
      <button
        className="tac"
        onClick={() => onSelect(null)}
        style={{
          padding: "var(--space-3) var(--space-4)",
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: "var(--space-2)",
          borderColor: "color-mix(in srgb, var(--term-accent) 50%, transparent)",
          background: "color-mix(in srgb, var(--term-accent) 6%, transparent)",
        }}
      >
        <span style={{ fontSize: 16, filter: "brightness(1.5)" }}>{"\u{2795}"}</span>
        <span
          style={{
            fontSize: "var(--font-size-base)",
            fontFamily: "var(--font-mono)",
            color: "var(--term-accent)",
            fontWeight: 600,
          }}
        >
          Blank Project
        </span>
      </button>

      {/* Template grid */}
      <div>
        <label
          className="tsl"
          style={{ display: "block", marginBottom: "var(--space-2)", fontSize: TERM_SIZE_2XS }}
        >
          or start from a template
        </label>
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
      </div>
    </div>
  );
}
