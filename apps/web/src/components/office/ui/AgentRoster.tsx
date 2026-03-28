"use client";
import type { AgentStat } from "./useDashboardData";
import {
  TERM_SURFACE,
  TERM_BORDER,
  TERM_DIM,
  TERM_TEXT,
  TERM_TEXT_BRIGHT,
  TERM_FONT,
  TERM_SIZE_2XS,
  TERM_SIZE_XS,
  TERM_SIZE_SM,
  TERM_SEM_GREEN,
  TERM_SEM_BLUE,
  TERM_SEM_YELLOW,
  TERM_SEM_RED,
} from "./termTheme";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtDuration(ms: number): string {
  if (ms === 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m${rem}s` : `${min}m`;
}

function statusDot(status: string): { color: string; label: string } {
  switch (status) {
    case "idle": return { color: TERM_SEM_GREEN, label: "idle" };
    case "working": return { color: TERM_SEM_BLUE, label: "working" };
    case "waiting_approval": return { color: TERM_SEM_YELLOW, label: "waiting" };
    case "error": return { color: TERM_SEM_RED, label: "error" };
    case "done": return { color: TERM_SEM_GREEN, label: "done" };
    default: return { color: TERM_DIM, label: status };
  }
}

interface AgentRosterProps {
  agents: AgentStat[];
}

export default function AgentRoster({ agents }: AgentRosterProps) {
  if (agents.length === 0) {
    return (
      <div style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, padding: "8px 0" }}>
        No agents active.
      </div>
    );
  }

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
        Agent Roster
      </div>
      <div
        style={{
          background: TERM_SURFACE,
          border: `1px solid ${TERM_BORDER}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {agents.map((a, i) => {
          const dot = statusDot(a.status);
          return (
            <div
              key={a.agentId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderTop: i > 0 ? `1px solid ${TERM_BORDER}` : "none",
                fontFamily: TERM_FONT,
              }}
            >
              {/* Name + role */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE_SM, fontWeight: 600 }}>
                  {a.name}
                </span>
                <span style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, marginLeft: 6 }}>
                  {a.role}
                </span>
              </div>

              {/* Stats */}
              <span
                style={{ color: TERM_TEXT, fontSize: TERM_SIZE_2XS, whiteSpace: "nowrap" }}
                title="Tasks completed"
              >
                {a.tasksCompleted} task{a.tasksCompleted !== 1 ? "s" : ""}
              </span>
              <span
                style={{ color: TERM_TEXT, fontSize: TERM_SIZE_2XS, whiteSpace: "nowrap" }}
                title="Total tokens used"
              >
                {fmtTokens(a.totalTokens)}
              </span>
              <span
                style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, whiteSpace: "nowrap" }}
                title="Average task duration"
              >
                {fmtDuration(a.avgTaskDurationMs)}
              </span>

              {/* Status dot */}
              <div
                title={dot.label}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: dot.color,
                  flexShrink: 0,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
