"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { TERM_PANEL, TERM_DIM, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";

function HireModal({ agentDefs, onHire, onCreate, onEdit, onDelete, onClose, assetsReady, detectedBackends }: {
  agentDefs: AgentDefinition[];
  onHire: (def: AgentDefinition, backend: string, workDir?: string) => void;
  onCreate: () => void;
  onEdit: (def: AgentDefinition) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
}) {
  const [selectedBackend, setSelectedBackend] = useState("claude");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState<string>("");

  // Leaders can only work in teams, not as solo agents
  const builtinAgents = agentDefs.filter((a) => a.isBuiltin && a.teamRole !== "leader");
  const customAgents = agentDefs.filter((a) => !a.isBuiltin && a.teamRole !== "leader");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: TERM_PANEL,
          width: "90%", maxWidth: 420, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", display: "flex", flexDirection: "column",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: 0, padding: "14px 18px 10px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em", flexShrink: 0 }}>Hire Agent</h2>

        <div style={{ padding: "0 18px", flexShrink: 0 }}>
        {/* Backend selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>AI BACKEND</div>
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
                    border: isSelected ? `1px solid ${b.color}` : "1px solid #1a2a1a",
                    backgroundColor: isSelected ? b.color + "20" : "transparent",
                    color: isSelected ? b.color : available ? "#6a5848" : "#8a6a6a",
                    cursor: "pointer", fontFamily: "monospace",
                    opacity: available ? 1 : 0.7,
                    position: "relative",
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

        {/* Working directory picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>WORKING DIRECTORY</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="Paste path or click Browse"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12,
                border: "1px solid #1a2a1a", backgroundColor: "#0a0e0a",
                color: "#eddcb8", fontFamily: "monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const rid = nanoid(6);
                folderPickCallbacks.set(rid, (p) => setWorkDir(p));
                sendCommand({ type: "PICK_FOLDER", requestId: rid });
              }}
              style={{
                padding: "6px 10px", border: "1px solid #1a2a1a",
                backgroundColor: "#0a0e0a", color: "#9a8a68",
                fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >Browse</button>
          </div>
          <div style={{ fontSize: 10, color: "#5a4a38", marginTop: 3, fontFamily: "monospace" }}>
            Empty = default workspace
          </div>
        </div>

        </div>
        <div data-scrollbar style={{ flex: 1, overflowY: "auto", padding: "0 18px" }}>
        {/* Built-in agents */}
        <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>BUILT-IN AGENTS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
          {builtinAgents.map((def) => (
            <button
              key={def.id}
              onClick={() => onHire(def, selectedBackend, workDir || undefined)}
              onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
              onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#1a2a1a"; }}
              title={def.skills ? `Skills: ${def.skills}` : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "12px 6px 10px", position: "relative",
                border: "1px solid #1a2a1a", backgroundColor: "transparent",
                cursor: "pointer", textAlign: "center",
                transition: "border-color 0.15s",
              }}
            >
              <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
              <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
              <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
              {hoveredId === def.id && (
                <span
                  onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                  style={{ position: "absolute", top: 4, right: 4, fontSize: 15, color: TERM_DIM, cursor: "pointer", padding: "2px 4px" }}
                  title="Edit"
                >&#9998;</span>
              )}
            </button>
          ))}
        </div>

        {/* Custom agents */}
        {customAgents.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>MY AGENTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
              {customAgents.map((def) => (
                <button
                  key={def.id}
                  onClick={() => onHire(def, selectedBackend, workDir || undefined)}
                  onMouseEnter={(e) => { setHoveredId(def.id); e.currentTarget.style.borderColor = "#e8b04040"; }}
                  onMouseLeave={(e) => { setHoveredId(null); e.currentTarget.style.borderColor = "#1a2a1a"; }}
                  title={def.skills ? `Skills: ${def.skills}` : undefined}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "12px 6px 10px", position: "relative",
                    border: "1px solid #1a2a1a", backgroundColor: "transparent",
                    cursor: "pointer", textAlign: "center",
                    transition: "border-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  {hoveredId === def.id && (
                    <span style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2, alignItems: "center" }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                        style={{ fontSize: 15, color: TERM_DIM, cursor: "pointer", padding: "2px 4px" }}
                        title="Edit"
                      >&#9998;</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                        style={{ fontSize: 16, color: TERM_SEM_RED, cursor: "pointer", padding: "2px 4px", fontWeight: 700 }}
                        title="Delete"
                      >&times;</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        </div>
        <div style={{ display: "flex", gap: 6, padding: "10px 18px 14px", flexShrink: 0, borderTop: "1px solid #1a2a1a" }}>
          <button
            onClick={onCreate}
            style={{
              flex: 1, padding: "9px",
              border: "1px solid #e8b04060", backgroundColor: "transparent",
              color: "#e8b040", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >+ Create New</button>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              border: "1px solid #1a2a1a", backgroundColor: "transparent",
              color: "#6a5848", fontSize: 14, cursor: "pointer", fontFamily: "monospace",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default HireModal;
