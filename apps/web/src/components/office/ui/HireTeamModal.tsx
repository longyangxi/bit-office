"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { TERM_PANEL, TERM_SURFACE, TERM_DIM, TERM_TEXT_BRIGHT, TERM_BORDER, TERM_BG, TERM_ACCENT, TERM_SEM_YELLOW, TERM_SIZE, TERM_SIZE_SM, TERM_SIZE_XS, TERM_SIZE_2XS } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";

function HireTeamModal({ agentDefs, onCreateTeam, onClose, assetsReady, detectedBackends, projectDir }: {
  agentDefs: AgentDefinition[];
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
  /** When set, directory is locked to project directory (project-centric mode) */
  projectDir?: string;
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  const [selectedDevId, setSelectedDevId] = useState<string>(devAgents[0]?.id ?? "");
  const [backends, setBackends] = useState<Record<string, string>>({});
  const [workDir, setWorkDir] = useState<string>(projectDir ?? "");
  const dirLocked = !!projectDir;

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [];
    if (selectedDevId) memberIds.push(selectedDevId);
    if (reviewer) memberIds.push(reviewer.id);
    onCreateTeam(leader.id, memberIds, backends, workDir || undefined);
  };

  const fixedRows: { def: AgentDefinition; label: string }[] = [];
  if (leader) fixedRows.push({ def: leader, label: "LEAD" });
  if (reviewer) fixedRows.push({ def: reviewer, label: "REVIEWER" });

  return (
    <TermModal
      open={true}
      onClose={onClose}
      maxWidth={540}
      zIndex={100}
      title="Hire Team"
      footer={
        <>
          <TermButton variant="primary" onClick={handleCreate} disabled={!leader} style={{ flex: 1, fontWeight: 700 }}>Create Team</TermButton>
          <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
        </>
      }
    >
      {/* Working directory picker */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: TERM_SIZE_SM, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
          PROJECT DIRECTORY{dirLocked && <span style={{ opacity: 0.5, marginLeft: 6 }}>(project)</span>}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <TermInput
            type="text"
            value={workDir}
            onChange={(e) => !dirLocked && setWorkDir(e.target.value)}
            placeholder="Paste path or click Browse"
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
          <div style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM, marginTop: 3, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
            Empty = default workspace
          </div>
        )}
      </div>

      <div style={{ fontSize: TERM_SIZE_SM, color: TERM_DIM, marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
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
              <div style={{ fontSize: TERM_SIZE, fontWeight: 700, color: TERM_TEXT_BRIGHT }}>
                {def.name} <span style={{ color: TERM_SEM_YELLOW, fontSize: TERM_SIZE_XS, fontFamily: "var(--font-mono)" }}>{label}</span>
              </div>
              <div style={{ fontSize: TERM_SIZE, color: TERM_DIM }}>{def.role}</div>
            </div>
            <select
              value={backends[def.id] ?? "claude"}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
              style={{
                padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                backgroundColor: TERM_BG, color: TERM_DIM, fontSize: TERM_SIZE_SM, cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              {BACKEND_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Dev cards */}
        <div style={{ fontSize: TERM_SIZE_SM, color: TERM_DIM, marginTop: 4, marginBottom: 4, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>DEV AGENT (pick 1)</div>
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
                  border: selected ? `1px solid ${TERM_ACCENT}60` : `1px solid ${TERM_BORDER}`,
                  backgroundColor: selected ? `${TERM_ACCENT}0a` : "transparent",
                  cursor: "pointer", textAlign: "center",
                  opacity: selected ? 1 : 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                }}
              >
                <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                <div style={{ fontSize: TERM_SIZE, fontWeight: 700, color: TERM_TEXT_BRIGHT, marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                <div style={{ fontSize: TERM_SIZE_SM, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                <select
                  value={backends[def.id] ?? "claude"}
                  onClick={(e) => { e.stopPropagation(); setSelectedDevId(def.id); }}
                  onChange={(e) => { setSelectedDevId(def.id); setBackends((prev) => ({ ...prev, [def.id]: e.target.value })); }}
                  style={{
                    marginTop: 6, padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                    backgroundColor: TERM_BG, color: TERM_DIM, fontSize: TERM_SIZE_SM, cursor: "pointer", fontFamily: "var(--font-mono)",
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
    </TermModal>
  );
}

export default HireTeamModal;
