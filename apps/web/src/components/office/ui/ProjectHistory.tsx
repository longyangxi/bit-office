"use client";
import { useEffect, useState } from "react";
import { useOfficeStore, type ProjectSummary } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";
import type { GatewayEvent } from "@office/shared";
import { TERM_BG, TERM_GREEN, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_PANEL, TERM_SURFACE, TERM_HOVER, TERM_BORDER, TERM_BORDER_DIM, TERM_SEM_BLUE, TERM_SEM_GREEN, TERM_SEM_YELLOW } from "./termTheme";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelativeDate(ts: number) {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(ts);
}

function formatDuration(start: number, end: number) {
  const ms = end - start;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function hasPreview(p?: ProjectSummary["preview"]): p is NonNullable<ProjectSummary["preview"]> {
  if (!p) return false;
  return !!(p.entryFile || p.previewCmd);
}

/** Replay PROJECT_DATA events into a readable chat log */
function ProjectViewer({ events, name, preview, onBack, onPreview }: {
  events: GatewayEvent[];
  name: string;
  preview?: ProjectSummary["preview"];
  onBack: () => void;
  onPreview?: (preview: NonNullable<ProjectSummary["preview"]>) => void;
}) {
  const messages: { id: string; agent: string; text: string; timestamp: number; type: string }[] = [];

  for (const event of events) {
    switch (event.type) {
      case "TEAM_CHAT":
        messages.push({
          id: `tc-${event.timestamp}-${event.fromAgentId}`,
          agent: event.fromAgentId,
          text: event.message,
          timestamp: event.timestamp,
          type: event.messageType,
        });
        break;
      case "TASK_DONE":
        if (event.result?.summary) {
          messages.push({
            id: `done-${event.taskId}`,
            agent: event.agentId,
            text: event.result.summary,
            timestamp: (event as Record<string, unknown>).timestamp as number ?? 0,
            type: "result",
          });
        }
        break;
      case "TASK_DELEGATED":
        messages.push({
          id: `del-${event.taskId}`,
          agent: event.fromAgentId,
          text: `Delegated to ${event.toAgentId}: ${event.prompt.slice(0, 200)}`,
          timestamp: (event as Record<string, unknown>).timestamp as number ?? 0,
          type: "delegation",
        });
        break;
      case "TEAM_PHASE":
        messages.push({
          id: `phase-${event.teamId}-${event.phase}`,
          agent: event.leadAgentId,
          text: `Phase: ${event.phase}`,
          timestamp: (event as Record<string, unknown>).timestamp as number ?? 0,
          type: "phase",
        });
        break;
    }
  }

  const typeStyles: Record<string, { bg: string; border: string; label: string; labelColor: string }> = {
    delegation: { bg: `${TERM_SEM_BLUE}0a`, border: `${TERM_SEM_BLUE}20`, label: "DELEGATE", labelColor: TERM_SEM_BLUE },
    result: { bg: `${TERM_SEM_GREEN}0a`, border: `${TERM_SEM_GREEN}20`, label: "DONE", labelColor: TERM_SEM_GREEN },
    phase: { bg: `${TERM_SEM_YELLOW}0a`, border: `${TERM_SEM_YELLOW}20`, label: "PHASE", labelColor: TERM_SEM_YELLOW },
    status: { bg: `${TERM_SURFACE}30`, border: TERM_BORDER_DIM, label: "STATUS", labelColor: TERM_DIM },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${TERM_BORDER}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={onBack}
                    style={{
            background: "none", border: `1px solid ${TERM_BORDER}`, color: TERM_DIM,
            padding: "5px 12px", cursor: "pointer", fontSize: 11, letterSpacing: "0.03em",
          }}
        >
          Back
        </button>
        <span className="px-font" style={{ color: TERM_GREEN, fontSize: 13, fontWeight: 600, flex: 1, letterSpacing: "0.02em" }}>
          {name}
        </span>
        {hasPreview(preview) && onPreview && (
          <button
            onClick={() => onPreview(preview)}
                        style={{
              background: `${TERM_SEM_GREEN}1f`, border: `1px solid ${TERM_SEM_GREEN}40`,
              color: TERM_SEM_GREEN, padding: "5px 14px", cursor: "pointer",
              fontSize: 11, letterSpacing: "0.03em",
            }}
          >
            Preview
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {messages.length === 0 && (
          <div className="px-font" style={{ color: TERM_DIM, fontSize: 12, textAlign: "center", padding: 40 }}>
            No messages in this project
          </div>
        )}
        {messages.map((msg) => {
          const s = typeStyles[msg.type] ?? typeStyles.status;
          return (
            <div key={msg.id} style={{
              marginBottom: 6, padding: "8px 10px",
              background: s.bg, borderLeft: `2px solid ${s.border}`,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                <span style={{
                  color: s.labelColor, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  fontFamily: "monospace", textTransform: "uppercase",
                }}>
                  {s.label}
                </span>
                <span style={{
                  color: TERM_TEXT, fontSize: 11, fontWeight: 600,
                  fontFamily: "monospace",
                }}>
                  {msg.agent.replace(/^agent-/, "").split("-")[0]}
                </span>
              </div>
              <div style={{
                color: TERM_TEXT, fontSize: 12, lineHeight: 1.5,
                fontFamily: "monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {msg.text.slice(0, 800)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectHistory({ isOpen, onClose, onPreview }: {
  isOpen: boolean;
  onClose: () => void;
  onPreview?: (preview: NonNullable<ProjectSummary["preview"]>, ratings?: Record<string, number>) => void;
}) {
  const { projectList, viewingProjectId, viewingProjectEvents, viewingProjectName, clearViewingProject } = useOfficeStore();
  const [loaded, setLoaded] = useState(false);

  const viewingProject = viewingProjectId ? projectList.find(p => p.id === viewingProjectId) : null;

  useEffect(() => {
    if (isOpen && !loaded) {
      sendCommand({ type: "LIST_PROJECTS" });
      setLoaded(true);
    }
    if (!isOpen) {
      setLoaded(false);
      clearViewingProject();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const handlePreview = (preview: NonNullable<ProjectSummary["preview"]>, ratings?: Record<string, number>) => {
    // Strip markdown formatting from archived preview fields (e.g. "** `npx vite`" → "npx vite")
    const clean = (v?: string) => v?.replace(/\*\*/g, "").replace(/`/g, "").replace(/^_+|_+$/g, "").trim() || undefined;
    const cmd = clean(preview.previewCmd);
    const entry = clean(preview.entryFile);
    const dir = preview.projectDir;
    // previewCmd+port takes priority (Vite/Python/etc need a server, static serve won't work)
    if (cmd && preview.previewPort) {
      sendCommand({ type: "SERVE_PREVIEW", previewCmd: cmd, previewPort: preview.previewPort, cwd: dir });
    } else if (cmd) {
      sendCommand({ type: "SERVE_PREVIEW", previewCmd: cmd, cwd: dir });
    } else if (entry && dir) {
      sendCommand({ type: "SERVE_PREVIEW", filePath: dir + "/" + entry });
    }
    onPreview?.(preview, ratings);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: TERM_BG, border: `2px solid ${TERM_GREEN}`,
          boxShadow: `0 0 40px ${TERM_GREEN}14, 4px 4px 0px rgba(0,0,0,0.5)`,
          width: "90%", maxWidth: 560, height: "70vh",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${TERM_GREEN}33`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span className="px-font" style={{ color: TERM_GREEN, fontSize: 13, fontWeight: 600, letterSpacing: "0.05em" }}>
            Project History
          </span>
          <button
            onClick={onClose}
                        style={{
              background: "none", border: "none", color: TERM_DIM,
              fontSize: 16, cursor: "pointer", lineHeight: 1,
            }}
          >
            x
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {viewingProjectId && viewingProjectEvents.length > 0 ? (
            <ProjectViewer
              events={viewingProjectEvents}
              name={viewingProjectName ?? "Project"}
              preview={viewingProject?.preview}
              onBack={clearViewingProject}
              onPreview={(p) => handlePreview(p, viewingProject?.ratings)}
            />
          ) : (
            <div style={{ padding: "6px 0" }}>
              {projectList.length === 0 ? (
                <div className="px-font" style={{
                  color: TERM_DIM, fontSize: 12, textAlign: "center",
                  padding: 40, lineHeight: 1.8,
                }}>
                  No archived projects yet.
                  <br />
                  Projects are saved when you click End Project.
                </div>
              ) : (
                projectList.map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      padding: "12px 18px",
                      borderBottom: i < projectList.length - 1 ? `1px solid ${TERM_BORDER_DIM}` : "none",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `${TERM_GREEN}0a`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      {/* Main content - clickable to view details */}
                      <button
                        onClick={() => sendCommand({ type: "LOAD_PROJECT", projectId: p.id })}
                        style={{
                          flex: 1, textAlign: "left", background: "none",
                          border: "none", cursor: "pointer", padding: 0,
                        }}
                      >
                        {/* Project name */}
                        <div style={{
                          color: TERM_TEXT_BRIGHT, fontSize: 12, fontWeight: 600,
                          fontFamily: "monospace", marginBottom: 5,
                        }}>
                          {p.name}
                        </div>
                        {/* Meta row */}
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: TERM_DIM,
                          }}>
                            {formatRelativeDate(p.endedAt)}
                          </span>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: TERM_GREEN, opacity: 0.6,
                          }}>
                            {formatDuration(p.startedAt, p.endedAt)}
                          </span>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: `${TERM_SEM_BLUE}80`,
                          }}>
                            {p.agentNames.length} agent{p.agentNames.length !== 1 ? "s" : ""}
                          </span>
                          {p.tokenUsage && (p.tokenUsage.inputTokens > 0 || p.tokenUsage.outputTokens > 0) && (
                            <span style={{
                              fontSize: 10, fontFamily: "monospace",
                              color: TERM_SEM_GREEN, opacity: 0.6,
                            }}
                              title={`Input: ${p.tokenUsage.inputTokens.toLocaleString()} / Output: ${p.tokenUsage.outputTokens.toLocaleString()}`}
                            >
                              {"\u2191"}{formatTokens(p.tokenUsage.inputTokens)} {"\u2193"}{formatTokens(p.tokenUsage.outputTokens)}
                            </span>
                          )}
                        </div>
                        {/* Agent names */}
                        <div style={{
                          fontSize: 10, fontFamily: "monospace",
                          color: TERM_DIM, marginTop: 4, opacity: 0.7,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {p.agentNames.join(" / ")}
                        </div>
                        {/* Ratings */}
                        {p.ratings && Object.keys(p.ratings).length > 0 && (
                          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                            {Object.entries(p.ratings).map(([key, val]) => {
                              const stars = Math.min(5, Math.max(0, Math.round(val)));
                              return (
                                <span key={key} style={{
                                  fontSize: 9, fontFamily: "monospace",
                                  color: `${TERM_GREEN}b3`,
                                }}>
                                  {key.slice(0, 4)} {"★".repeat(stars)}{"☆".repeat(5 - stars)}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </button>
                      {/* Preview button */}
                      {hasPreview(p.preview) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(p.preview!, p.ratings); }}
                                                    style={{
                            background: `${TERM_SEM_GREEN}1a`, border: `1px solid ${TERM_SEM_GREEN}40`,
                            color: TERM_SEM_GREEN, padding: "5px 12px", cursor: "pointer",
                            fontSize: 10, letterSpacing: "0.04em",
                            flexShrink: 0, marginTop: 2,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = `${TERM_SEM_GREEN}33`; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = `${TERM_SEM_GREEN}1a`; }}
                        >
                          Preview
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
