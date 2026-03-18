"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { TERM_PANEL, TERM_SURFACE, TERM_DIM, TERM_TEXT_BRIGHT, TERM_SEM_YELLOW } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";

function HireTeamModal({ agentDefs, onCreateTeam, onClose, assetsReady, detectedBackends }: {
  agentDefs: AgentDefinition[];
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  const [selectedDevId, setSelectedDevId] = useState<string>(devAgents[0]?.id ?? "");
  const [backends, setBackends] = useState<Record<string, string>>({});
  const [workDir, setWorkDir] = useState<string>("");

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [];
    if (selectedDevId) memberIds.push(selectedDevId);
    if (reviewer) memberIds.push(reviewer.id);
    onCreateTeam(leader.id, memberIds, backends, workDir || undefined);
  };

  // Fixed rows (leader + reviewer) + toggleable dev rows
  const fixedRows: { def: AgentDefinition; label: string }[] = [];
  if (leader) fixedRows.push({ def: leader, label: "LEAD" });
  if (reviewer) fixedRows.push({ def: reviewer, label: "REVIEWER" });

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
          backgroundColor: TERM_PANEL, padding: "18px 18px 14px",
          width: "90%", maxWidth: 440, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: "0 0 14px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>Hire Team</h2>

        {/* Working directory picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 5, fontFamily: "monospace", letterSpacing: "0.05em" }}>PROJECT DIRECTORY</div>
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

        <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 6, fontFamily: "monospace", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          {/* Fixed rows: leader and reviewer */}
          {fixedRows.map(({ def, label }) => (
            <div
              key={def.id}
              title={def.skills ? `Skills: ${def.skills}` : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                border: `1px solid ${TERM_SEM_YELLOW}70`,
                backgroundColor: TERM_SURFACE,
                textAlign: "left",
              }}
            >
              <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: TERM_TEXT_BRIGHT }}>
                  {def.name} <span style={{ color: TERM_SEM_YELLOW, fontSize: 11, fontFamily: "monospace" }}>{label}</span>
                </div>
                <div style={{ fontSize: 13, color: TERM_DIM }}>{def.role}</div>
              </div>
              <select
                value={backends[def.id] ?? "claude"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
                style={{
                  padding: "3px 6px", border: "1px solid #1a2a1a",
                  backgroundColor: "#0a0e0a", color: "#9a8a68", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                }}
              >
                {BACKEND_OPTIONS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
                ))}
              </select>
            </div>
          ))}

          {/* Dev cards — single select grid */}
          <div style={{ fontSize: 12, color: "#7a6858", marginTop: 4, marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>DEV AGENT (pick 1)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
            {devAgents.map((def) => {
              const selected = selectedDevId === def.id;
              return (
                <button
                  key={def.id}
                  onClick={() => setSelectedDevId(def.id)}
                  title={def.skills ? `Skills: ${def.skills}` : undefined}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "12px 6px 10px",
                    border: selected ? "1px solid #e8b04060" : "1px solid #1a2a1a",
                    backgroundColor: selected ? "#2a2200" : "transparent",
                    cursor: "pointer", textAlign: "center",
                    opacity: selected ? 1 : 0.5,
                    transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                  }}
                >
                  <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#eddcb8", marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                  <div style={{ fontSize: 12, color: "#7a6858", marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                  <select
                    value={backends[def.id] ?? "claude"}
                    onClick={(e) => { e.stopPropagation(); setSelectedDevId(def.id); }}
                    onChange={(e) => { setSelectedDevId(def.id); setBackends((prev) => ({ ...prev, [def.id]: e.target.value })); }}
                    style={{
                      marginTop: 6, padding: "3px 6px", border: "1px solid #1a2a1a",
                      backgroundColor: "#0a0e0a", color: "#9a8a68", fontSize: 12, cursor: "pointer", fontFamily: "monospace",
                    }}
                  >
                    {BACKEND_OPTIONS.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
                    ))}
                  </select>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleCreate}
            style={{
              flex: 1, padding: "9px", border: "1px solid #e8b04060",
              backgroundColor: "#382800", color: "#e8b040", fontSize: 14,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              opacity: leader ? 1 : 0.4,
            }}
            disabled={!leader}
          >Create Team</button>
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

export default HireTeamModal;
