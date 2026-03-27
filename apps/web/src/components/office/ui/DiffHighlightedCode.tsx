"use client";

import { TERM_SEM_GREEN, TERM_SEM_RED, TERM_DIM } from "./termTheme";

/** Render diff-highlighted lines for code blocks with language "diff" */
export function DiffHighlightedCode({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        let color = "inherit";
        let bg = "transparent";
        if (line.startsWith("+")) { color = TERM_SEM_GREEN; bg = `${TERM_SEM_GREEN}08`; }
        else if (line.startsWith("-")) { color = TERM_SEM_RED; bg = `${TERM_SEM_RED}08`; }
        else if (line.startsWith("@@")) { color = TERM_DIM; }
        return (
          <span key={i} style={{ display: "block", color, backgroundColor: bg, padding: "0 6px", margin: "0 -6px", borderRadius: 1 }}>
            {line}
          </span>
        );
      })}
    </>
  );
}
