"use client";

import { useOfficeStore } from "@/store/office-store";
import type { Project } from "@/store/office-store";
import { useMemo } from "react";

interface ConsoleSidebarProps {
  onNewProject: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onBackToOffice: () => void;
  onCloseProject: (projectId: string) => void;
  onHireToProject: (projectId: string) => void;
}

export default function ConsoleSidebar({ onNewProject, onOpenHistory, onOpenSettings, onBackToOffice, onCloseProject, onHireToProject }: ConsoleSidebarProps) {
  const projects = useOfficeStore((s) => s.projects);
  const activeProjectId = useOfficeStore((s) => s.activeProjectId);
  const agents = useOfficeStore((s) => s.agents);
  const setActiveProject = useOfficeStore((s) => s.setActiveProject);

  const activeProjects = useMemo(() => {
    const list: Project[] = [];
    for (const [, p] of projects) {
      if (p.status === "active") list.push(p);
    }
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }, [projects]);

  return (
    <div className="csb">
      {/* Back to Office — top */}
      <button className="csb-nav-btn" onClick={onBackToOffice}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span>Office</span>
      </button>

      {/* Projects section */}
      <div className="csb-section">
        <div className="csb-section-header">
          <span className="csb-section-title">Projects</span>
          <button
            className="csb-add-btn"
            onClick={onNewProject}
            title="New Project"
          >
            +
          </button>
        </div>
        <div className="csb-list">
          {activeProjects.map((p) => {
            const isActive = p.id === activeProjectId;
            const agentCount = p.agentIds.filter((id) => agents.has(id)).length;
            return (
              <div
                key={p.id}
                className={`csb-item${isActive ? " csb-item-active" : ""}`}
                onClick={() => setActiveProject(p.id)}
                title={p.directory}
              >
                <span className="csb-item-icon">📁</span>
                <span className="csb-item-name">{p.name}</span>
                {agentCount > 0 && (
                  <span className="csb-item-badge">{agentCount}</span>
                )}
                <button
                  className="csb-item-action csb-item-add"
                  onClick={(e) => { e.stopPropagation(); onHireToProject(p.id); }}
                  title="Add agent to project"
                >
                  +
                </button>
                <button
                  className="csb-item-action csb-item-close"
                  onClick={(e) => { e.stopPropagation(); onCloseProject(p.id); }}
                  title="Close project"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spacer */}
      <div className="csb-spacer" />

      {/* History */}
      <button className="csb-nav-btn" onClick={onOpenHistory}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>History</span>
      </button>

      {/* Settings — bottom */}
      <button className="csb-nav-btn csb-nav-bottom" onClick={onOpenSettings}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Settings</span>
      </button>
    </div>
  );
}
