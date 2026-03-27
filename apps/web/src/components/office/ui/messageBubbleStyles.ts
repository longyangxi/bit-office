import { TERM_SIZE, TERM_FONT } from "./termTheme";

/* ── Action button style — follows theme accent via CSS var ── */
export const accentBtnStyle: React.CSSProperties = {
  color: "var(--term-accent)",
  border: "1px solid color-mix(in srgb, var(--term-accent) 55%, transparent)",
  padding: "3px 10px", fontSize: TERM_SIZE, fontFamily: TERM_FONT,
  backgroundColor: "transparent",
  transition: "border-color 0.15s ease, color 0.15s ease",
  display: "inline-block", verticalAlign: "middle",
  letterSpacing: "0.02em",
  borderRadius: 4,
  cursor: "pointer",
};
export const previewBtnStyle = accentBtnStyle;
export const reviewBtnStyle: React.CSSProperties = {
  ...accentBtnStyle,
  color: "var(--term-text)",
  border: "1px solid color-mix(in srgb, var(--term-text) 40%, transparent)",
};
