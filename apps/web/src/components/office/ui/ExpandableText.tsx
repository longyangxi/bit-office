"use client";

import { useState } from "react";

function ExpandableText({ text, maxChars = 300, maxHeight = 120 }: { text: string; maxChars?: number; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  return (
    <>
      <div style={{
        fontSize: 12, color: "#b09878", wordBreak: "break-word",
        maxHeight: expanded ? "none" : maxHeight, overflow: "hidden", fontFamily: "monospace",
      }}>
        {expanded ? text : text.slice(0, maxChars)}{!expanded && isLong ? "..." : ""}
      </div>
      {isLong && (
        <div
          style={{ fontSize: 10, color: "#6a8aaa", cursor: "pointer", marginTop: 2, fontFamily: "monospace" }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "\u25B2 Collapse" : "\u25BC Show more"}
        </div>
      )}
    </>
  );
}

export default ExpandableText;
