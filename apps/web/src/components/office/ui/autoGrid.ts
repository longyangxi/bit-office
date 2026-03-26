/**
 * Auto-grid layout calculator.
 * Returns optimal cols × rows based on agent count.
 * Phase 1 of project-centric architecture.
 *
 * | Agents | Grid | Notes           |
 * |--------|------|-----------------|
 * | 1      | 1×1  | Full width      |
 * | 2      | 2×1  | Side by side    |
 * | 3      | 3×1  | Three columns   |
 * | 4      | 2×2  | Square grid     |
 * | 5-6    | 3×2  | Two rows        |
 * | 7+     | 3×2  | + pagination    |
 */
export function computeAutoGrid(agentCount: number): { cols: number; rows: number } {
  if (agentCount <= 0) return { cols: 1, rows: 1 };
  if (agentCount === 1) return { cols: 1, rows: 1 };
  if (agentCount === 2) return { cols: 2, rows: 1 };
  if (agentCount === 3) return { cols: 3, rows: 1 };
  if (agentCount === 4) return { cols: 2, rows: 2 };
  // 5+ agents: 3 columns, 2 rows (with pagination for 7+)
  return { cols: 3, rows: 2 };
}
