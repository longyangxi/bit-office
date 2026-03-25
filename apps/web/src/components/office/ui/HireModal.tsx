"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { generateRandomName } from "./office-utils";
import { TERM_PANEL, TERM_DIM, TERM_BORDER, TERM_BG, TERM_GREEN, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";

/** Shared agent card style */
const agentCardStyle = (isSelected: boolean): React.CSSProperties => ({
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "12px 6px 10px", position: "relative",
  border: `1px solid ${isSelected ? TERM_GREEN : TERM_BORDER}`,
  backgroundColor: isSelected ? `${TERM_GREEN}12` : "transparent",
  cursor: "pointer", textAlign: "center",
  transition: "border-color 0.15s, background-color 0.15s",
});

function HireModal({ agentDefs, onHire, onCreate, onEdit, onDelete, onClose, assetsReady, detectedBackends }: {
  agentDefs: AgentDefinition[];
  onHire: (def: AgentDefinition, backend: string, workDir?: string, displayName?: string) => void;
  onCreate: () => void;
  onEdit: (def: AgentDefinition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedDef, setSelectedDef] = useState<AgentDefinition | null>(null);
  const [hireName, setHireName] = useState(() => generateRandomName());
  const [workDir, setWorkDir] = useState<string>("");

  const builtinAgents = agentDefs.filter((a) => a.isBuiltin && a.teamRole !== "leader");
  const customAgents = agentDefs.filter((a) => !a.isBuiltin && a.teamRole !== "leader");

  const handleSelectAgent = (def: AgentDefinition) => {
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

  /** Render a single agent card */
  const renderAgentCard = (def: AgentDefinition, showDelete: boolean) => {
    const isSelected = selectedDef?.id === def.id;
    return (
      <button
        key={def.id}
        onClick={() => handleSelectAgent(def)}
        onMouseEnter={() => setHoveredId(def.id)}
        onMouseLeave={() => setHoveredId(null)}
        title={def.skills ? `Skills: ${def.skills}` : undefined}
        style={agentCardStyle(isSelected)}
      >
        <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
        <div style={{ fontSize: 14, fontWeight: 700, color: TERM_TEXT_BRIGHT, marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
        <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
        {hoveredId === def.id && (
          <span style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2, alignItems: "center" }}>
            <span
              onClick={(e) => { e.stopPropagation(); onEdit(def); }}
              style={{ fontSize: 15, color: TERM_DIM, cursor: "pointer", padding: "2px 4px" }}
              title="Edit"
            >&#9998;</span>
            {showDelete && (
              <span
                onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                style={{ fontSize: 16, color: TERM_SEM_RED, cursor: "pointer", padding: "2px 4px", fontWeight: 700 }}
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
      maxWidth={520}
      zIndex={100}
      title="Hire Agent"
      footer={
        <TermButton variant="dim" onClick={onClose} style={{ padding: "9px 16px" }}>Cancel</TermButton>
      }
    >
      {/* Backend selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>AI BACKEND</div>
        <div style={{ display: "flex", gap: 4 }}>
          {BACKEND_OPTIONS.map((b) => {
            const available = !detectedBackends || detectedBackends.length === 0 || detectedBackends.includes(b.id);
            const isSelected = selectedBackend === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setSelectedBackend(b.id)}
                style={{
                  flex: 1, padding: "6px 4px", fontSize: 13, fontWeight: 600,
                  border: isSelected ? `1px solid ${TERM_GREEN}` : `1px solid ${TERM_BORDER}`,
                  backgroundColor: isSelected ? TERM_GREEN + "20" : "transparent",
                  color: isSelected ? TERM_GREEN : TERM_DIM,
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                  opacity: available ? 1 : 0.7,
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

      {/* Built-in agents */}
      <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>BUILT-IN AGENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
        {builtinAgents.map((def) => renderAgentCard(def, false))}
      </div>

      {/* Custom agents + Create New card */}
      <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>MY AGENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
        {customAgents.map((def) => renderAgentCard(def, true))}
        {/* "+ Create New" card — same size as agent cards */}
        <button
          onClick={onCreate}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "12px 6px 10px",
            border: `1px dashed ${TERM_BORDER}`,
            backgroundColor: "transparent",
            cursor: "pointer", textAlign: "center",
            transition: "border-color 0.15s, color 0.15s",
            color: TERM_DIM, minHeight: 80,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = TERM_GREEN; e.currentTarget.style.color = TERM_GREEN; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = TERM_BORDER; e.currentTarget.style.color = TERM_DIM; }}
        >
          <span style={{ fontSize: 24, lineHeight: 1, fontWeight: 300 }}>+</span>
          <span style={{ fontSize: 11, marginTop: 4, fontFamily: "var(--font-mono)" }}>Create New</span>
        </button>
      </div>

      {/* -- Selection panel: workDir + name + hire button -- */}
      {selectedDef && (
        <div style={{
          padding: "10px 12px",
          border: `1px solid ${TERM_GREEN}40`,
          backgroundColor: `${TERM_GREEN}08`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 12, color: TERM_GREEN, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {selectedDef.role}
          </div>
          {/* Working directory */}
          <div>
            <div style={{ fontSize: 11, color: TERM_DIM, marginBottom: 3, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>WORKING DIRECTORY</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <TermInput
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder="~/.open-office/projects"
                style={{ flex: 1 }}
              />
              <TermButton
                variant="dim"
                onClick={() => {
                  const rid = nanoid(6);
                  folderPickCallbacks.set(rid, (p) => setWorkDir(p));
                  sendCommand({ type: "PICK_FOLDER", requestId: rid });
                }}
              >Browse</TermButton>
            </div>
            <div style={{ fontSize: 10, color: TERM_DIM, marginTop: 2, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
              Empty = default workspace
            </div>
          </div>
          {/* Random name */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: TERM_DIM, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>NAME</span>
              <button
                onClick={() => setHireName(generateRandomName())}
                title="Randomize name"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: TERM_DIM, fontSize: 13, padding: 0, lineHeight: 1,
                  fontFamily: "var(--font-mono)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = TERM_GREEN; }}
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
      )}
    </TermModal>
  );
}

export default HireModal;
