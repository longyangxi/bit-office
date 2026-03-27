/**
 * Auto-grid layout calculator.
 * Returns optimal cols × rows based on agent count and available width.
 * Responsive: caps columns on narrow viewports so each pane stays usable.
 *
 * | Agents | Wide (≥1200) | Medium (900-1199) | Narrow (<900) |
 * |--------|-------------|-------------------|---------------|
 * | 1      | 1×1         | 1×1               | 1×1           |
 * | 2      | 2×1         | 2×1               | 1×2           |
 * | 3      | 3×1         | 2×2               | 1×2 +page     |
 * | 4      | 2×2         | 2×2               | 1×2 +page     |
 * | 5-6    | 3×2         | 2×2 +page         | 1×2 +page     |
 * | 7+     | 3×2 +page   | 2×2 +page         | 1×2 +page     |
 */
export function computeAutoGrid(agentCount: number, viewportWidth?: number): { cols: number; rows: number } {
  if (agentCount <= 0) return { cols: 1, rows: 1 };
  if (agentCount === 1) return { cols: 1, rows: 1 };

  // Determine max columns based on available width
  // Each pane needs ~380px minimum to display code/messages comfortably
  const vw = viewportWidth ?? 1400; // default to wide if not provided
  const maxCols = vw < 900 ? 1 : vw < 1200 ? 2 : 3;

  if (agentCount === 2) {
    return maxCols >= 2 ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  }
  if (agentCount === 3) {
    if (maxCols >= 3) return { cols: 3, rows: 1 };
    if (maxCols >= 2) return { cols: 2, rows: 2 };
    return { cols: 1, rows: 2 };
  }
  if (agentCount === 4) {
    return maxCols >= 2 ? { cols: 2, rows: 2 } : { cols: 1, rows: 2 };
  }
  // 5+ agents: fill with available columns, 2 rows (pagination for overflow)
  return { cols: Math.min(maxCols, 3), rows: 2 };
}
