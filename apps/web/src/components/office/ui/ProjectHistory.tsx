"use client";
import { useEffect, useState } from "react";
import { useOfficeStore, type ProjectSummary } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";
import type { GatewayEvent } from "@office/shared";
import { cn } from "@/lib/utils";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

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

  const typeConfig: Record<string, { twBorder: string; twBg: string; label: string; twLabel: string }> = {
    delegation: { twBorder: "border-l-sem-blue/20", twBg: "bg-sem-blue/[0.04]", label: "DELEGATE", twLabel: "text-sem-blue" },
    result: { twBorder: "border-l-sem-green/20", twBg: "bg-sem-green/[0.04]", label: "DONE", twLabel: "text-sem-green" },
    phase: { twBorder: "border-l-sem-yellow/20", twBg: "bg-sem-yellow/[0.04]", label: "PHASE", twLabel: "text-sem-yellow" },
    status: { twBorder: "border-l-border", twBg: "bg-muted/20", label: "STATUS", twLabel: "text-muted-foreground" },
  };

  return (
    <div className="flex flex-col h-full -m-4">
      {/* Viewer header with back button */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2.5 shrink-0">
        <TermButton variant="dim" size="sm" onClick={onBack}>Back</TermButton>
        <span className="text-accent font-mono text-term font-semibold tracking-wide flex-1 truncate">
          {name}
        </span>
        {hasPreview(preview) && onPreview && (
          <TermButton variant="success" size="sm" onClick={() => onPreview(preview)}>Preview</TermButton>
        )}
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-auto px-3 py-2">
        {messages.length === 0 && (
          <div className="text-muted-foreground font-mono text-term text-center py-10">
            No messages in this project
          </div>
        )}
        {messages.map((msg) => {
          const s = typeConfig[msg.type] ?? typeConfig.status;
          return (
            <div key={msg.id} className={cn("mb-1.5 px-2.5 py-2 border-l-2", s.twBorder, s.twBg)}>
              <div className="flex gap-2 items-center mb-0.5">
                <span className={cn("text-[9px] font-bold tracking-widest font-mono uppercase", s.twLabel)}>
                  {s.label}
                </span>
                <span className="text-foreground text-[11px] font-semibold font-mono">
                  {msg.agent.replace(/^agent-/, "").split("-")[0]}
                </span>
              </div>
              <div className="text-foreground text-term leading-normal font-mono whitespace-pre-wrap break-words">
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
    const clean = (v?: string) => v?.replace(/\*\*/g, "").replace(/`/g, "").replace(/^_+|_+$/g, "").trim() || undefined;
    const cmd = clean(preview.previewCmd);
    const entry = clean(preview.entryFile);
    const dir = preview.projectDir;
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
    <TermModal
      open={isOpen}
      onClose={onClose}
      maxWidth={600}
      title="Project History"
      className="h-[70vh]"
    >
      {viewingProjectId && viewingProjectEvents.length > 0 ? (
        <ProjectViewer
          events={viewingProjectEvents}
          name={viewingProjectName ?? "Project"}
          preview={viewingProject?.preview}
          onBack={clearViewingProject}
          onPreview={(p) => handlePreview(p, viewingProject?.ratings)}
        />
      ) : (
        <div>
          {projectList.length === 0 ? (
            <div className="text-muted-foreground font-mono text-term text-center py-10 leading-relaxed">
              No archived projects yet.
              <br />
              Projects are saved when you click End Project.
            </div>
          ) : (
            projectList.map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  "px-4 py-3 cursor-pointer transition-colors hover:bg-accent/[0.04]",
                  i < projectList.length - 1 && "border-b border-term-border-dim",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Main content - clickable to view details */}
                  <button
                    onClick={() => sendCommand({ type: "LOAD_PROJECT", projectId: p.id })}
                    className="flex-1 text-left bg-transparent border-none cursor-pointer p-0"
                  >
                    {/* Project name */}
                    <div className="text-term-text-bright text-term font-semibold font-mono mb-1">
                      {p.name}
                    </div>
                    {/* Meta row */}
                    <div className="flex gap-3 items-center flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formatRelativeDate(p.endedAt)}
                      </span>
                      <span className="text-[10px] font-mono text-accent opacity-60">
                        {formatDuration(p.startedAt, p.endedAt)}
                      </span>
                      <span className="text-[10px] font-mono text-sem-blue/50">
                        {p.agentNames.length} agent{p.agentNames.length !== 1 ? "s" : ""}
                      </span>
                      {p.tokenUsage && (p.tokenUsage.inputTokens > 0 || p.tokenUsage.outputTokens > 0) && (
                        <span
                          className="text-[10px] font-mono text-sem-green opacity-60"
                          title={`Input: ${p.tokenUsage.inputTokens.toLocaleString()} / Output: ${p.tokenUsage.outputTokens.toLocaleString()}`}
                        >
                          {"\u2191"}{formatTokens(p.tokenUsage.inputTokens)} {"\u2193"}{formatTokens(p.tokenUsage.outputTokens)}
                        </span>
                      )}
                    </div>
                    {/* Agent names */}
                    <div className="text-[10px] font-mono text-muted-foreground mt-1 opacity-70 truncate">
                      {p.agentNames.join(" / ")}
                    </div>
                    {/* Ratings */}
                    {p.ratings && Object.keys(p.ratings).length > 0 && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {Object.entries(p.ratings).map(([key, val]) => {
                          const stars = Math.min(5, Math.max(0, Math.round(val)));
                          return (
                            <span key={key} className="text-[9px] font-mono text-accent/70">
                              {key.slice(0, 4)} {"★".repeat(stars)}{"☆".repeat(5 - stars)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </button>
                  {/* Preview button */}
                  {hasPreview(p.preview) && (
                    <TermButton
                      variant="success"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handlePreview(p.preview!, p.ratings); }}
                      className="shrink-0 mt-0.5"
                    >
                      Preview
                    </TermButton>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </TermModal>
  );
}
