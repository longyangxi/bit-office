"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { generateRandomName } from "./office-utils";
import { TERM_PANEL, TERM_DIM, TERM_BORDER, TERM_BG, TERM_ACCENT, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SIZE, TERM_SIZE_ICON, TERM_SIZE_XS, TERM_SIZE_XL, TERM_SIZE_2XS, TERM_SIZE_LG } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";

function HireModal({ agentDefs, onHire, onCreate, onEdit, onDelete, onClose, assetsReady, detectedBackends, projectDir }: {
  agentDefs: AgentDefinition[];
  onHire: (def: AgentDefinition, backend: string, workDir?: string, displayName?: string) => void;
  onCreate: () => void;
  onEdit: (def: AgentDefinition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
  /** When set, directory is locked to project directory (project-centric mode) */
  projectDir?: string;
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedDef, setSelectedDef] = useState<AgentDefinition | null>(null);
  const [hireName, setHireName] = useState(() => generateRandomName());
  const [workDir, setWorkDir] = useState<string>(projectDir ?? "");
  const dirLocked = !!projectDir;

  const builtinAgents = agentDefs.filter((a) => a.isBuiltin && a.teamRole === "dev");
  const customAgents = agentDefs.filter((a) => !a.isBuiltin && a.teamRole === "dev");

  const handleSelectAgent = (def: AgentDefinition) => {
    // Project mode: instant hire — skip the overlay (auto-name, project dir)
    if (dirLocked) {
      onHire(def, selectedBackend, workDir || undefined, undefined);
      return;
    }
    if (selectedDef?.id === def.id) {
      setSelectedDef(null);
    } else {
      setSelectedDef(def);
      setHireName(generateRandomName());
    }
  };

  const handleDoHire = () => {
    if (!selectedDef) return;
    onHire(selectedDef, selectedBackend, workDir || undefined, hireName.trim() || undefined);
  };

  /** Render a single agent card — avatar + role */
  const renderAgentCard = (def: AgentDefinition, showDelete: boolean) => {
    const isSelected = selectedDef?.id === def.id;
    const isHovered = hoveredId === def.id;
    return (
      <button
        key={def.id}
        onClick={() => handleSelectAgent(def)}
        onMouseEnter={() => setHoveredId(def.id)}
        onMouseLeave={() => setHoveredId(null)}
        title={def.skills ? `Skills: ${def.skills}` : def.role}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "var(--space-3) var(--space-2) var(--space-2)", position: "relative",
          border: `1px solid ${isSelected ? TERM_ACCENT : isHovered ? TERM_BORDER : TERM_BORDER + "80"}`,
          borderRadius: "var(--radius-md)",
          backgroundColor: isSelected ? `${TERM_ACCENT}12` : isHovered ? `${TERM_TEXT}08` : "transparent",
          cursor: "pointer", textAlign: "center",
          transition: "border-color 0.15s, background-color 0.15s",
          gap: "var(--space-2)",
        }}
      >
        <div style={{ width: 32, height: 48, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
        </div>
        <div style={{
          fontSize: "var(--font-size-xs)", fontFamily: "var(--font-sans)", fontWeight: 500,
          color: isSelected ? TERM_ACCENT : TERM_TEXT,
          width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{def.role}</div>
        {isHovered && (
          <span style={{ position: "absolute", top: 3, right: 3, display: "flex", gap: 2, alignItems: "center" }}>
            <span
              onClick={(e) => { e.stopPropagation(); onEdit(def); }}
              style={{ fontSize: TERM_SIZE, color: TERM_DIM, cursor: "pointer", padding: "2px 3px", lineHeight: 1 }}
              title="Edit"
            >&#9998;</span>
            {showDelete && (
              <span
                onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                style={{ fontSize: TERM_SIZE_ICON, color: TERM_SEM_RED, cursor: "pointer", padding: "2px 3px", fontWeight: 700, lineHeight: 1 }}
                title="Delete"
              >&times;</span>
            )}
          </span>
        )}
      </button>
    );
  };

  return (
    <TermModal
      open={true}
      onClose={onClose}
      maxWidth={440}
      zIndex={100}
      title={dirLocked ? "Add Agent to Project" : "Hire Agent"}
      className="max-h-[min(712px,85vh)]"
      footer={
        <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
      }
    >
      <div>
        {/* Project context badge */}
        {dirLocked && (
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)", marginBottom: "var(--space-3)",
            backgroundColor: "color-mix(in srgb, var(--term-accent) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--term-accent) 20%, transparent)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-xs)", fontFamily: "var(--font-mono)", color: TERM_TEXT,
          }}>
            <span style={{ color: TERM_DIM }}>DIR</span>
            <span style={{ color: TERM_TEXT_BRIGHT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workDir}</span>
          </div>
        )}

        {/* Backend selector */}
        <div style={{ marginBottom: "var(--space-3)" }}>
          <div style={{ fontSize: "var(--font-size-xs)", color: TERM_DIM, marginBottom: "var(--space-1)", fontFamily: "var(--font-sans)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>AI BACKEND</div>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            {BACKEND_OPTIONS.map((b) => {
              const available = !detectedBackends || detectedBackends.length === 0 || detectedBackends.includes(b.id);
              const isSelected = selectedBackend === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBackend(b.id)}
                  style={{
                    flex: 1, padding: "var(--space-2) var(--space-1)", fontSize: "var(--font-size-sm)", fontWeight: 500,
                    border: isSelected ? `1px solid ${TERM_ACCENT}` : `1px solid ${TERM_BORDER}80`,
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: isSelected ? TERM_ACCENT + "20" : "transparent",
                    color: isSelected ? TERM_ACCENT : TERM_DIM,
                    cursor: "pointer", fontFamily: "var(--font-sans)",
                    opacity: available ? 1 : 0.7,
                    transition: "border-color 0.15s, background-color 0.15s",
                  }}
                >
                  <span style={{
                    display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                    backgroundColor: available ? TERM_SEM_GREEN : TERM_SEM_YELLOW,
                    marginRight: 4, verticalAlign: "middle",
                  }} />
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable agent list */}
        <div data-scrollbar style={{ maxHeight: "55vh", overflowY: "auto", overflowX: "hidden" }}>
          {/* Built-in agents */}
          <div style={{ fontSize: "var(--font-size-xs)", color: TERM_DIM, marginBottom: "var(--space-1)", fontFamily: "var(--font-sans)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>BUILT-IN AGENTS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {builtinAgents.map((def) => renderAgentCard(def, false))}
          </div>

          {/* Custom agents + Create New card */}
          <div style={{ fontSize: "var(--font-size-xs)", color: TERM_DIM, marginBottom: "var(--space-1)", fontFamily: "var(--font-sans)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>MY AGENTS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {customAgents.map((def) => renderAgentCard(def, true))}
            {/* "+ Create New" card */}
            <button
              onClick={onCreate}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 4, padding: "10px 6px 8px",
                border: `1px dashed ${TERM_BORDER}80`,
                borderRadius: "var(--radius-md)",
                backgroundColor: "transparent",
                cursor: "pointer", textAlign: "center",
                transition: "border-color 0.15s, color 0.15s",
                color: TERM_DIM, minHeight: 80,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = TERM_ACCENT; e.currentTarget.style.color = TERM_ACCENT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = TERM_BORDER + "80"; e.currentTarget.style.color = TERM_DIM; }}
            >
              <span style={{ fontSize: TERM_SIZE_XL, lineHeight: 1, fontWeight: 300 }}>+</span>
              <span style={{ fontSize: TERM_SIZE_XS, fontFamily: "var(--font-sans)", fontWeight: 500 }}>Create New</span>
            </button>
          </div>
        </div>

        {/* Project mode hint */}
        {dirLocked && (
          <div style={{ fontSize: TERM_SIZE_XS, color: TERM_DIM, fontFamily: "var(--font-sans)", textAlign: "center", padding: "8px 0 2px", opacity: 0.7 }}>
            Click an agent to add it instantly
          </div>
        )}

        {/* -- Centered overlay: workDir + name + hire (non-project mode only) -- */}
        {selectedDef && !dirLocked && (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              display: "flex", alignItems: "center", justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.5)",
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedDef(null); }}
          >
            <div
              style={{
                width: 360, maxWidth: "90vw",
                padding: "var(--space-4)",
                border: `1px solid ${TERM_ACCENT}50`,
                borderRadius: "var(--radius-lg)",
                backgroundColor: TERM_BG,
                boxShadow: "var(--shadow-xl)",
                display: "flex", flexDirection: "column", gap: "var(--space-3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <SpriteAvatar palette={selectedDef.palette} zoom={2} ready={assetsReady} />
                <div style={{ fontSize: "var(--font-size-base)", color: TERM_ACCENT, fontFamily: "var(--font-mono)", fontWeight: 600, flex: 1 }}>
                  {selectedDef.role}
                </div>
                <button
                  onClick={() => setSelectedDef(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: TERM_DIM, fontSize: TERM_SIZE_LG, padding: "2px 4px", lineHeight: 1 }}
                >&times;</button>
              </div>
              {/* Working directory */}
              <div>
                <div style={{ fontSize: "var(--font-size-xs)", color: TERM_DIM, marginBottom: "var(--space-1)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
                  WORKING DIRECTORY{dirLocked && <span style={{ opacity: 0.5, marginLeft: "var(--space-2)" }}>(project)</span>}
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                  <TermInput
                    type="text"
                    value={workDir}
                    onChange={(e) => !dirLocked && setWorkDir(e.target.value)}
                    placeholder="~/.open-office/projects"
                    style={{ flex: 1, opacity: dirLocked ? 0.6 : 1 }}
                    readOnly={dirLocked}
                  />
                  {!dirLocked && (
                    <TermButton
                      variant="dim"
                      onClick={() => {
                        const rid = nanoid(6);
                        folderPickCallbacks.set(rid, (p) => setWorkDir(p));
                        sendCommand({ type: "PICK_FOLDER", requestId: rid });
                      }}
                    >Browse</TermButton>
                  )}
                </div>
                {!dirLocked && (
                  <div style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM, marginTop: 2, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
                    Empty = default workspace
                  </div>
                )}
              </div>
              {/* Name */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
                  <span style={{ fontSize: "var(--font-size-xs)", color: TERM_DIM, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>NAME</span>
                  <button
                    onClick={() => setHireName(generateRandomName())}
                    title="Randomize name"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: TERM_DIM, fontSize: TERM_SIZE, padding: 0, lineHeight: 1,
                      fontFamily: "var(--font-mono)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = TERM_ACCENT; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; }}
                  >&#x21bb;</button>
                </div>
                <TermInput
                  type="text"
                  value={hireName}
                  onChange={(e) => setHireName(e.target.value)}
                  placeholder="Agent display name"
                />
              </div>
              {/* Hire button */}
              <TermButton
                variant="primary"
                onClick={handleDoHire}
                style={{ padding: "9px", fontWeight: 700, width: "100%" }}
              >
                hire
              </TermButton>
            </div>
          </div>
        )}
      </div>
    </TermModal>
  );
}

export default HireModal;
