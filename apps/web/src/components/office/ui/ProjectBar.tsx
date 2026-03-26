"use client";

import { useOfficeStore } from "@/store/office-store";
import type { Project } from "@/store/office-store";
import { useCallback, useMemo } from "react";

interface ProjectBarProps {
  onNewProject: () => void;
}

/**
 * ProjectBar — Tab-style project switcher at top of workspace.
 * Shows active projects as tabs, with [+] for new project.
 * Phase 1 of project-centric architecture.
 */
export default function ProjectBar({ onNewProject }: ProjectBarProps) {
  const projects = useOfficeStore((s) => s.projects);
  const activeProjectId = useOfficeStore((s) => s.activeProjectId);
  const agents = useOfficeStore((s) => s.agents);
  const setActiveProject = useOfficeStore((s) => s.setActiveProject);

  const activeProjects = useMemo(() => {
    const list: Project[] = [];
    for (const [, p] of projects) {
      if (p.status === "active") list.push(p);
    }
    // Sort by creation time (newest last — like browser tabs)
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }, [projects]);

  const handleTabClick = useCallback(
    (projectId: string) => {
      setActiveProject(projectId);
    },
    [setActiveProject]
  );

  // Don't render if no projects exist yet
  if (activeProjects.length === 0) return null;

  return (
    <div className="pbar">
      <div className="pbar-tabs">
        {activeProjects.map((p) => {
          const isActive = p.id === activeProjectId;
          const agentCount = p.agentIds.filter((id) => agents.has(id)).length;
          return (
            <button
              key={p.id}
              className={`pbar-tab${isActive ? " pbar-tab-active" : ""}`}
              onClick={() => handleTabClick(p.id)}
              title={p.directory}
            >
              <span className="pbar-tab-name">{p.name}</span>
              <span className="pbar-tab-count">{agentCount}</span>
            </button>
          );
        })}
        <button
          className="pbar-tab pbar-tab-new"
          onClick={onNewProject}
          title="New Project"
        >
          +
        </button>
      </div>
    </div>
  );
}
