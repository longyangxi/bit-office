"use client";
import {
  TERM_SURFACE,
  TERM_BORDER,
  TERM_DIM,
  TERM_TEXT_BRIGHT,
  TERM_FONT,
  TERM_SIZE_2XS,
  TERM_SIZE_2XL,
  TERM_SEM_GREEN,
  TERM_SEM_BLUE,
  TERM_SEM_PURPLE,
  TERM_SEM_YELLOW,
} from "./termTheme";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

interface StatCardProps {
  label: string;
  value: string;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div
      style={{
        flex: 1,
        background: TERM_SURFACE,
        border: `1px solid ${TERM_BORDER}`,
        borderRadius: 6,
        padding: "10px 12px",
        textAlign: "center",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: TERM_SIZE_2XS,
          color: TERM_DIM,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: TERM_SIZE_2XL,
          fontWeight: 700,
          fontFamily: TERM_FONT,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

interface DashboardStatsProps {
  totalProjects: number;
  totalFilesChanged: number;
  totalTokens: { input: number; output: number };
  totalCostUsd: number;
}

export default function DashboardStats({
  totalProjects,
  totalFilesChanged,
  totalTokens,
}: DashboardStatsProps) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <StatCard label="Projects" value={String(totalProjects)} color={TERM_SEM_GREEN} />
      <StatCard label="Events" value={fmtTokens(totalFilesChanged)} color={TERM_SEM_BLUE} />
      <StatCard label="Tokens In" value={fmtTokens(totalTokens.input)} color={TERM_SEM_PURPLE} />
      <StatCard label="Tokens Out" value={fmtTokens(totalTokens.output)} color={TERM_SEM_YELLOW} />
    </div>
  );
}
