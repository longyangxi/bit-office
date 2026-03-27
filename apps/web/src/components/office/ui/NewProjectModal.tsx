"use client";

import { useState, useCallback } from "react";
import { nanoid } from "nanoid";
import { useOfficeStore, folderPickCallbacks } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";
import { TERM_SIZE_2XS } from "./termTheme";

type InitialMode = "solo" | "team" | "empty";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** After project created, caller may open HireModal/HireTeamModal scoped to this project */
  onCreated: (projectId: string, mode: InitialMode) => void;
}

/**
 * NewProjectModal — Create a new project with directory + initial agent mode.
 * Directory is chosen ONCE here, never again for this project.
 * Phase 1 of project-centric architecture.
 */
export default function NewProjectModal({
  open,
  onClose,
  onCreated,
}: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [mode, setMode] = useState<InitialMode>("solo");

  const createProject = useOfficeStore((s) => s.createProject);

  const handleBrowse = useCallback(() => {
    const rid = nanoid(6);
    folderPickCallbacks.set(rid, (path: string) => {
      setDirectory(path);
      // Auto-fill name from folder name if empty
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
    // Reset form
    setName("");
    setDirectory("");
    setMode("solo");
  }, [name, directory, mode, createProject, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && directory.trim()) handleCreate();
    },
    [onClose, handleCreate, directory]
  );

  if (!open) return null;

  return (
    <div className="tm-backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="tm-container"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tm-header">
          <span>NEW PROJECT</span>
          <button className="tm-close" onClick={onClose}>
            ESC
          </button>
        </div>

        {/* Body */}
        <div className="tm-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
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
        </div>

        {/* Footer */}
        <div className="tm-footer">
          <button
            className="tb tb-primary"
            onClick={handleCreate}
            disabled={!directory.trim()}
          >
            CREATE PROJECT
          </button>
        </div>
      </div>
    </div>
  );
}
