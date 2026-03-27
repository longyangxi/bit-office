"use client";

import { useState } from "react";
import { TERM_TEXT, TERM_DIM, TERM_SIZE_SM, TERM_SIZE_2XS } from "./termTheme";

function ExpandableText({ text, maxChars = 300, maxHeight = 120 }: { text: string; maxChars?: number; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  return (
    <>
      <div style={{
        fontSize: TERM_SIZE_SM, color: TERM_TEXT, wordBreak: "break-word",
        maxHeight: expanded ? "none" : maxHeight, overflow: "hidden", fontFamily: "monospace",
      }}>
        {expanded ? text : text.slice(0, maxChars)}{!expanded && isLong ? "..." : ""}
      </div>
      {isLong && (
        <div
          style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM, cursor: "pointer", marginTop: 2, fontFamily: "monospace" }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "\u25B2 Collapse" : "\u25BC Show more"}
        </div>
      )}
    </>
  );
}

export default ExpandableText;
