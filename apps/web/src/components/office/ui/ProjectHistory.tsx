"use client";
import { useEffect, useState } from "react";
import { useOfficeStore, type ProjectSummary } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";
import type { GatewayEvent } from "@office/shared";

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
    delegation: { bg: "rgba(90, 172, 255, 0.06)", border: "rgba(90, 172, 255, 0.12)", label: "DELEGATE", labelColor: "#5aacff" },
    result: { bg: "rgba(72, 204, 106, 0.06)", border: "rgba(72, 204, 106, 0.12)", label: "DONE", labelColor: "#48cc6a" },
    phase: { bg: "rgba(232, 176, 64, 0.06)", border: "rgba(232, 176, 64, 0.12)", label: "PHASE", labelColor: "#e8b040" },
    status: { bg: "rgba(255, 255, 255, 0.02)", border: "rgba(255, 255, 255, 0.06)", label: "STATUS", labelColor: "rgba(255,255,255,0.4)" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={onBack}
                    style={{
            background: "none", border: "1px solid rgba(255, 255, 255, 0.15)", color: "rgba(255, 255, 255, 0.5)",
            padding: "5px 12px", cursor: "pointer", fontSize: 11, letterSpacing: "0.03em",
          }}
        >
          Back
        </button>
        <span className="px-font" style={{ color: "#e8b040", fontSize: 13, fontWeight: 600, flex: 1, letterSpacing: "0.02em" }}>
          {name}
        </span>
        {hasPreview(preview) && onPreview && (
          <button
            onClick={() => onPreview(preview)}
                        style={{
              background: "rgba(72, 204, 106, 0.12)", border: "1px solid rgba(72, 204, 106, 0.25)",
              color: "#48cc6a", padding: "5px 14px", cursor: "pointer",
              fontSize: 11, letterSpacing: "0.03em",
            }}
          >
            Preview
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {messages.length === 0 && (
          <div className="px-font" style={{ color: "rgba(255, 255, 255, 0.3)", fontSize: 12, textAlign: "center", padding: 40 }}>
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
                  color: "rgba(255, 255, 255, 0.6)", fontSize: 11, fontWeight: 600,
                  fontFamily: "monospace",
                }}>
                  {msg.agent.replace(/^agent-/, "").split("-")[0]}
                </span>
              </div>
              <div style={{
                color: "rgba(255, 255, 255, 0.55)", fontSize: 12, lineHeight: 1.5,
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
  onPreview?: (preview: NonNullable<ProjectSummary["preview"]>) => void;
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

  const handlePreview = (preview: NonNullable<ProjectSummary["preview"]>) => {
    // previewCmd+port takes priority (Vite/Python/etc need a server, static serve won't work)
    if (preview.previewCmd && preview.previewPort) {
      sendCommand({
        type: "SERVE_PREVIEW",
        previewCmd: preview.previewCmd,
        previewPort: preview.previewPort,
        cwd: preview.projectDir,
      });
    } else if (preview.previewCmd) {
      sendCommand({
        type: "SERVE_PREVIEW",
        previewCmd: preview.previewCmd,
        cwd: preview.projectDir,
      });
    } else if (preview.entryFile && preview.projectDir) {
      const fullPath = preview.projectDir + "/" + preview.entryFile;
      sendCommand({ type: "SERVE_PREVIEW", filePath: fullPath });
    }
    onPreview?.(preview);
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
          backgroundColor: "#14141a", border: "2px solid #e8b040",
          boxShadow: "0 0 40px rgba(200,155,48,0.08), 4px 4px 0px rgba(0,0,0,0.5)",
          width: "90%", maxWidth: 560, height: "70vh",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(232, 176, 64, 0.2)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span className="px-font" style={{ color: "#e8b040", fontSize: 13, fontWeight: 600, letterSpacing: "0.05em" }}>
            Project History
          </span>
          <button
            onClick={onClose}
                        style={{
              background: "none", border: "none", color: "rgba(255, 255, 255, 0.3)",
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
              onPreview={handlePreview}
            />
          ) : (
            <div style={{ padding: "6px 0" }}>
              {projectList.length === 0 ? (
                <div className="px-font" style={{
                  color: "rgba(255, 255, 255, 0.3)", fontSize: 12, textAlign: "center",
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
                      borderBottom: i < projectList.length - 1 ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232, 176, 64, 0.04)"; }}
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
                          color: "rgba(255, 255, 255, 0.85)", fontSize: 12, fontWeight: 600,
                          fontFamily: "monospace", marginBottom: 5,
                        }}>
                          {p.name}
                        </div>
                        {/* Meta row */}
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: "rgba(255, 255, 255, 0.35)",
                          }}>
                            {formatRelativeDate(p.endedAt)}
                          </span>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: "#e8b040", opacity: 0.6,
                          }}>
                            {formatDuration(p.startedAt, p.endedAt)}
                          </span>
                          <span style={{
                            fontSize: 10, fontFamily: "monospace",
                            color: "rgba(90, 172, 255, 0.5)",
                          }}>
                            {p.agentNames.length} agent{p.agentNames.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {/* Agent names */}
                        <div style={{
                          fontSize: 10, fontFamily: "monospace",
                          color: "rgba(255, 255, 255, 0.25)", marginTop: 4,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {p.agentNames.join(" / ")}
                        </div>
                      </button>
                      {/* Preview button */}
                      {hasPreview(p.preview) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(p.preview!); }}
                                                    style={{
                            background: "rgba(72, 204, 106, 0.1)", border: "1px solid rgba(72, 204, 106, 0.25)",
                            color: "#48cc6a", padding: "5px 12px", cursor: "pointer",
                            fontSize: 10, letterSpacing: "0.04em",
                            flexShrink: 0, marginTop: 2,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(72, 204, 106, 0.2)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(72, 204, 106, 0.1)"; }}
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
