"use client";
import type { HeatmapCell } from "./useDashboardData";
import {
  TERM_DIM,
  TERM_SIZE_3XS,
  TERM_SIZE_2XS,
  TERM_FONT,
  TERM_BORDER,
  TERM_SEM_GREEN,
} from "./termTheme";

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LABEL_W = 28;

// 5 intensity colors — transparent base, green scale
function cellColor(intensity: 0 | 1 | 2 | 3 | 4): string {
  switch (intensity) {
    case 0: return "transparent";
    case 1: return "#0e4429";
    case 2: return "#006d32";
    case 3: return "#26a641";
    case 4: return "#39d353";
  }
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ActivityHeatmapProps {
  data: HeatmapCell[];
}

export default function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  if (data.length === 0) {
    return (
      <div style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, padding: "8px 0" }}>
        No activity yet.
      </div>
    );
  }

  // Group by week columns (Mon=0 .. Sun=6)
  const weeks: HeatmapCell[][] = [];
  let currentWeek: HeatmapCell[] = [];

  for (let i = 0; i < data.length; i++) {
    const d = new Date(data[i].date + "T00:00:00");
    const dow = (d.getDay() + 6) % 7; // Mon=0

    if (dow === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(data[i]);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const numWeeks = weeks.length;
  const svgW = LABEL_W + numWeeks * STEP;
  const svgH = 16 + 7 * STEP; // 16px top for week labels

  return (
    <div>
      <div
        style={{
          fontSize: TERM_SIZE_2XS,
          color: TERM_DIM,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        Activity (last 12 weeks)
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg
          width={svgW}
          height={svgH}
          style={{ display: "block", fontFamily: TERM_FONT }}
        >
          {/* Day labels on left */}
          {DAY_LABELS.map((label, i) => (
            <text
              key={label}
              x={LABEL_W - 4}
              y={16 + i * STEP + CELL - 2}
              textAnchor="end"
              fontSize={TERM_SIZE_3XS}
              fill={TERM_DIM}
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {weeks.map((week, wi) => {
            return week.map((cell) => {
              const d = new Date(cell.date + "T00:00:00");
              const dow = (d.getDay() + 6) % 7;
              const x = LABEL_W + wi * STEP;
              const y = 16 + dow * STEP;
              const fill = cellColor(cell.intensity);
              const title = `${cell.count} task${cell.count !== 1 ? "s" : ""} on ${formatDateLabel(cell.date)}`;

              return (
                <rect
                  key={cell.date}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={fill}
                  stroke={cell.intensity === 0 ? TERM_BORDER : "none"}
                  strokeWidth={cell.intensity === 0 ? 0.5 : 0}
                >
                  <title>{title}</title>
                </rect>
              );
            });
          })}
        </svg>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 6,
          fontSize: TERM_SIZE_3XS,
          color: TERM_DIM,
        }}
      >
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: cellColor(i),
              border: i === 0 ? `0.5px solid ${TERM_BORDER}` : "none",
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
