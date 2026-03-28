"use client";

import { useState, useCallback } from "react";
import { nanoid } from "nanoid";
import { useOfficeStore, folderPickCallbacks } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";
import { TERM_SIZE_2XS } from "./termTheme";
import TemplateSelector from "@/templates/TemplateSelector";
import type { ProjectTemplate } from "@/templates/templates";

type InitialMode = "solo" | "team" | "empty";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** After project created, caller may open HireModal/HireTeamModal scoped to this project */
  onCreated: (projectId: string, mode: InitialMode, template?: ProjectTemplate) => void;
}

/**
 * NewProjectModal — Create a new project with directory + initial agent mode.
 * Templates: one-click instant start (default directory, solo Senior Dev).
 * Blank: shows full form for name/directory/mode.
 */
export default function NewProjectModal({
  open,
  onClose,
  onCreated,
}: NewProjectModalProps) {
  const [showBlankForm, setShowBlankForm] = useState(false);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [mode, setMode] = useState<InitialMode>("solo");

  const createProject = useOfficeStore((s) => s.createProject);

  // Template one-click: create project with template name, empty directory (gateway uses default)
  const handleTemplateClick = useCallback((t: ProjectTemplate) => {
    const projectId = createProject(t.name, "");
    onCreated(projectId, "solo", t);
    // Reset
    setShowBlankForm(false);
    setName("");
    setDirectory("");
    setMode("solo");
  }, [createProject, onCreated]);

  const handleBrowse = useCallback(() => {
    const rid = nanoid(6);
    folderPickCallbacks.set(rid, (path: string) => {
      setDirectory(path);
      if (!name) {
        const folderName = path.split("/").filter(Boolean).pop() || "";
        setName(folderName);
      }
    });
    sendCommand({ type: "PICK_FOLDER", requestId: rid });
  }, [name]);

  const handleCreate = useCallback(() => {
    if (!directory.trim()) return;
    const projectName = name.trim() || directory.split("/").filter(Boolean).pop() || "untitled";
    const projectId = createProject(projectName, directory.trim());
    onCreated(projectId, mode);
    // Reset
    setShowBlankForm(false);
    setName("");
    setDirectory("");
    setMode("solo");
  }, [name, directory, mode, createProject, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showBlankForm) setShowBlankForm(false);
        else onClose();
      }
      if (e.key === "Enter" && showBlankForm && directory.trim()) handleCreate();
    },
    [onClose, handleCreate, directory, showBlankForm]
  );

  if (!open) return null;

  return (
    <div className="tm-backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="tm-container"
        style={{ maxWidth: showBlankForm ? 520 : 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tm-header">
          <span>{showBlankForm ? "BLANK PROJECT" : "NEW PROJECT"}</span>
          <button className="tm-close" onClick={showBlankForm ? () => setShowBlankForm(false) : onClose}>
            {showBlankForm ? "BACK" : "ESC"}
          </button>
        </div>

        {/* Body */}
        <div className="tm-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {!showBlankForm ? (
            /* ── Template selection (one-click) ── */
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label className="tsl">Pick a template to start instantly</label>
              <TemplateSelector selected={null} onSelect={(t) => { if (t) handleTemplateClick(t); else setShowBlankForm(true); }} />
            </div>
          ) : (
            /* ── Blank project form ── */
            <>
              {/* Project Name */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <label className="tsl">Name</label>
                <input
                  className="ti"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="auto from folder name"
                  autoFocus
                />
              </div>

              {/* Directory */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <label className="tsl">Directory</label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <input
                    className="ti"
                    style={{ flex: 1 }}
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    placeholder="/path/to/project"
                  />
                  <button className="tb tb-ghost" onClick={handleBrowse}>
                    Browse
                  </button>
                </div>
              </div>

              {/* Initial Agents Mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <label className="tsl">Initial Agents</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
                  {(
                    [
                      { key: "solo", label: "Solo Agent", desc: "Single agent" },
                      { key: "team", label: "Team", desc: "Lead + Dev + Review" },
                      { key: "empty", label: "Empty", desc: "Add agents later" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      className={`tac${mode === opt.key ? " tac-selected" : ""}`}
                      onClick={() => setMode(opt.key)}
                      style={{ padding: "var(--space-3) var(--space-2)" }}
                    >
                      <span
                        style={{
                          fontSize: "var(--font-size-base)",
                          fontFamily: "var(--font-mono)",
                          color: mode === opt.key ? "var(--term-accent)" : "var(--term-text-bright)",
                          fontWeight: 600,
                        }}
                      >
                        {opt.label}
                      </span>
                      <span
                        style={{
                          fontSize: TERM_SIZE_2XS,
                          fontFamily: "var(--font-mono)",
                          color: "var(--term-text)",
                          opacity: 0.6,
                          marginTop: "var(--space-1)",
                        }}
                      >
                        {opt.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer — only for blank form */}
        {showBlankForm && (
          <div className="tm-footer">
            <button
              className="tb tb-primary"
              onClick={handleCreate}
              disabled={!directory.trim()}
            >
              CREATE PROJECT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
