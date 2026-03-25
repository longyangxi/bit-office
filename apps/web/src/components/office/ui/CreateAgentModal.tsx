"use client";

import { useState, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { ROLE_CATALOG, ROLE_DESC_MAP, ROLE_PRESETS, PERSONALITY_PRESETS } from "./office-constants";
import { TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_BG, TERM_TEXT, TERM_GREEN, TERM_DIM, TERM_SEM_BLUE } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import { isRealEnter } from "./office-utils";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";
import { useOfficeStore } from "@/store/office-store";

const TERM_YELLOW = "#e5c07b";

function RoleSearchSelect({ value, onSelect }: { value: string; onSelect: (role: string) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const query = search.toLowerCase();
  const filtered = query
    ? ROLE_CATALOG.map((cat) => ({
        ...cat,
        agents: cat.agents.filter((a) =>
          a.name.toLowerCase().includes(query) || a.desc.toLowerCase().includes(query) || cat.label.toLowerCase().includes(query)
        ),
      })).filter((cat) => cat.agents.length > 0)
    : ROLE_CATALOG;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <TermInput
        value={open ? search : value}
        onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(""); }}
        placeholder="Search roles or type custom..."
      />
      {open && (
        <div data-scrollbar style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          maxHeight: 250, overflowY: "auto", backgroundColor: TERM_BG,
          border: `1px solid ${TERM_BORDER}`, borderTop: "none",
        }}>
          {filtered.map((cat) => (
            <div key={cat.category}>
              <div style={{
                padding: "4px 10px", fontSize: 10, color: TERM_DIM,
                fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em",
                backgroundColor: TERM_BG, position: "sticky", top: 0,
              }}>
                {cat.label}
              </div>
              {cat.agents.map((a) => (
                <div
                  key={a.name}
                  onClick={() => { onSelect(a.name); setOpen(false); setSearch(""); }}
                  style={{
                    padding: "5px 10px", fontSize: 13, fontFamily: "var(--font-mono)",
                    color: a.name === value ? TERM_GREEN : TERM_TEXT,
                    cursor: "pointer", backgroundColor: a.name === value ? `${TERM_GREEN}18` : "transparent",
                  }}
                  onMouseEnter={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = TERM_SURFACE; }}
                  onMouseLeave={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {a.name}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && search.trim() && (
            <div
              onClick={() => { onSelect(search.trim()); setOpen(false); setSearch(""); }}
              style={{ padding: "8px 10px", fontSize: 13, fontFamily: "var(--font-mono)", color: TERM_DIM, cursor: "pointer" }}
            >
              Use custom: &quot;{search.trim()}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline modal for creating a new skill file */
function CreateSkillInline({ onSave, onCancel }: {
  onSave: (name: string, content: string) => void;
  onCancel: () => void;
}) {
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");

  const handleSave = () => {
    const name = skillName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-|-$/g, "");
    if (!name || !skillContent.trim()) return;
    onSave(name, skillContent);
  };

  return (
    <div style={{
      border: `1px solid ${TERM_YELLOW}40`,
      backgroundColor: `${TERM_YELLOW}08`,
      padding: 10,
      marginTop: 6,
    }}>
      <div style={{ fontSize: 11, color: TERM_YELLOW, marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
        NEW SKILL FILE
      </div>
      <TermInput
        value={skillName}
        onChange={(e) => setSkillName(e.target.value)}
        placeholder="Skill name (e.g. tdd, react-patterns)"
        style={{ marginBottom: 6 }}
      />
      <textarea
        className="ti ti-textarea"
        value={skillContent}
        onChange={(e) => setSkillContent(e.target.value)}
        placeholder={"# Skill Title\n\nPaste or type skill content in Markdown..."}
        rows={5}
        style={{ resize: "vertical", marginBottom: 6, width: "100%", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <TermButton variant="dim" onClick={onCancel} style={{ padding: "4px 10px", fontSize: 12 }}>
          Cancel
        </TermButton>
        <TermButton
          variant="primary"
          onClick={handleSave}
          disabled={!skillName.trim() || !skillContent.trim()}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          Save Skill
        </TermButton>
      </div>
    </div>
  );
}

function CreateAgentModal({ onSave, onClose, assetsReady, editAgent, sendCommand }: {
  onSave: (agent: AgentDefinition) => void;
  onClose: () => void;
  assetsReady?: boolean;
  editAgent?: AgentDefinition | null;
  sendCommand?: (cmd: any) => void;
}) {
  const [palette, setPalette] = useState(editAgent?.palette ?? Math.floor(Math.random() * 6));

  const [rolePresetIndex, setRolePresetIndex] = useState<number>(() => {
    if (!editAgent?.role) return 0;
    const idx = ROLE_PRESETS.indexOf(editAgent.role);
    return idx >= 0 ? idx : -1;
  });
  const [customRole, setCustomRole] = useState(() => {
    if (!editAgent?.role) return "";
    const idx = ROLE_PRESETS.indexOf(editAgent.role);
    return idx >= 0 ? "" : editAgent.role;
  });

  // Skill files state
  const availableSkills = useOfficeStore((s) => s.availableSkills);
  const [selectedSkillFiles, setSelectedSkillFiles] = useState<Set<string>>(() => {
    return new Set(editAgent?.skillFiles ?? []);
  });
  const [showCreateSkill, setShowCreateSkill] = useState(false);

  // Request skill list on mount
  useEffect(() => {
    sendCommand?.({ type: "LIST_SKILLS" });
  }, [sendCommand]);

  const currentRole = rolePresetIndex >= 0 ? ROLE_PRESETS[rolePresetIndex] : customRole.trim();

  const handleRoleChange = (idx: number) => {
    setRolePresetIndex(idx);
  };

  const toggleSkillFile = (name: string) => {
    setSelectedSkillFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleCreateSkill = (skillName: string, content: string) => {
    sendCommand?.({ type: "SAVE_SKILL", name: skillName, content });
    setSelectedSkillFiles((prev) => new Set(prev).add(skillName));
    setShowCreateSkill(false);
  };

  const [personalityMode, setPersonalityMode] = useState<number>(() => {
    if (!editAgent) return 0;
    const idx = PERSONALITY_PRESETS.findIndex((p) => p.value === editAgent.personality);
    return idx >= 0 ? idx : 4;
  });
  const [customPersonality, setCustomPersonality] = useState(editAgent?.personality ?? "");

  const currentPersonality = personalityMode < 4
    ? PERSONALITY_PRESETS[personalityMode].value
    : customPersonality;

  // Name is assigned at hire time — use role as definition display name
  const defName = editAgent?.name ?? currentRole;

  const handleSave = () => {
    if (!currentRole.trim()) return;
    const id = editAgent
      ? editAgent.id
      : (defName.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "agent") + `-${nanoid(4)}`;
    const skillFilesArr = Array.from(selectedSkillFiles);
    onSave({
      id,
      name: defName.trim(),
      role: currentRole,
      skills: ROLE_DESC_MAP.get(currentRole) ?? "",
      personality: currentPersonality,
      palette,
      isBuiltin: editAgent?.isBuiltin ?? false,
      teamRole: editAgent?.teamRole ?? "dev",
      ...(skillFilesArr.length > 0 ? { skillFiles: skillFilesArr } : {}),
    });
  };

  return (
    <TermModal
      open={true}
      onClose={onClose}
      maxWidth={520}
      zIndex={110}
      title={editAgent ? "Edit Agent" : "Create Agent"}
      footer={
        <>
          <TermButton variant="primary" onClick={handleSave} disabled={!currentRole.trim()} style={{ flex: 1, fontWeight: 700 }}>
            {editAgent ? "Save" : "Create"}
          </TermButton>
          <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
        </>
      }
    >
      {/* Avatar */}
      <div className="mb-3">
        <div className="text-term text-muted-foreground font-mono tracking-wide mb-1">AVATAR</div>
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4, 5].map((p) => (
            <button
              key={p}
              onClick={() => setPalette(p)}
              style={{
                padding: 3, border: palette === p ? `2px solid ${TERM_GREEN}` : `2px solid ${TERM_BORDER}`,
                backgroundColor: palette === p ? `${TERM_GREEN}18` : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <SpriteAvatar palette={p} zoom={2} ready={assetsReady} />
            </button>
          ))}
        </div>
      </div>

      {/* Role */}
      <div style={{ marginBottom: 8, position: "relative" }}>
        <div className="text-term text-muted-foreground font-mono tracking-wide mb-1">ROLE</div>
        <RoleSearchSelect
          value={currentRole}
          onSelect={(roleName) => {
            const idx = ROLE_PRESETS.indexOf(roleName);
            if (idx >= 0) {
              handleRoleChange(idx);
            } else {
              setRolePresetIndex(-1);
              setCustomRole(roleName);
            }
          }}
        />
        {ROLE_DESC_MAP.get(currentRole) && (
          <div style={{ fontSize: 11, color: TERM_DIM, marginTop: 4, fontFamily: "var(--font-mono)", lineHeight: 1.4 }}>
            {ROLE_DESC_MAP.get(currentRole)}
          </div>
        )}
      </div>

      {/* Skill Files */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontSize: 12, color: TERM_DIM, marginBottom: 4, fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>SKILL FILES</span>
          <span style={{ fontSize: 10, color: TERM_DIM, fontWeight: 400 }}>
            .md instructions auto-loaded by AI
          </span>
        </div>
        {availableSkills.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
            {availableSkills.map((skill) => {
              const active = selectedSkillFiles.has(skill.name);
              return (
                <label
                  key={skill.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    cursor: "pointer", fontSize: 13, fontFamily: "var(--font-mono)",
                    color: active ? TERM_TEXT : TERM_DIM,
                    backgroundColor: active ? `${TERM_GREEN}0c` : "transparent",
                    border: `1px solid ${active ? TERM_GREEN + "30" : "transparent"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleSkillFile(skill.name)}
                    style={{ accentColor: TERM_GREEN, cursor: "pointer" }}
                  />
                  <span style={{ flex: 1 }}>{skill.title}</span>
                  {skill.isFolder && (
                    <span style={{ fontSize: 10, color: TERM_DIM, opacity: 0.6 }} title="Folder with multiple files">
                      [dir]
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {/* Selected skills not in available list (stale references) */}
        {(() => {
          const availableNames = new Set(availableSkills.map((s) => s.name));
          const stale = Array.from(selectedSkillFiles).filter((n) => !availableNames.has(n));
          if (stale.length === 0) return null;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              {stale.map((name) => (
                <span
                  key={name}
                  style={{
                    padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)",
                    border: `1px solid ${TERM_BORDER}`, color: TERM_DIM, opacity: 0.5,
                    display: "flex", alignItems: "center", gap: 4,
                  }}
                >
                  {name}
                  <span
                    onClick={() => toggleSkillFile(name)}
                    style={{ cursor: "pointer", fontSize: 14, lineHeight: 1 }}
                  >&times;</span>
                </span>
              ))}
            </div>
          );
        })()}
        {availableSkills.length === 0 && !showCreateSkill && (
          <div style={{ fontSize: 12, color: TERM_DIM, fontFamily: "var(--font-mono)", marginBottom: 4, opacity: 0.7 }}>
            No skill files yet.
          </div>
        )}
        {!showCreateSkill ? (
          <TermButton
            variant="dim"
            onClick={() => setShowCreateSkill(true)}
            style={{ padding: "4px 10px", fontSize: 12, width: "100%" }}
          >
            + Create Skill File
          </TermButton>
        ) : (
          <CreateSkillInline
            onSave={handleCreateSkill}
            onCancel={() => setShowCreateSkill(false)}
          />
        )}
      </div>

      {/* Personality — 2-column grid */}
      <div style={{ marginBottom: 10 }}>
        <div className="text-term text-muted-foreground font-mono tracking-wide mb-1">PERSONALITY</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {PERSONALITY_PRESETS.map((p, i) => (
            <label
              key={i}
              className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer font-mono text-[13px]"
              style={{ color: personalityMode === i ? TERM_TEXT : TERM_DIM }}
            >
              <input
                type="radio"
                name="personality"
                checked={personalityMode === i}
                onChange={() => setPersonalityMode(i)}
                style={{ accentColor: TERM_GREEN, cursor: "pointer" }}
              />
              {p.label}
            </label>
          ))}
          <label
            className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer font-mono text-[13px]"
            style={{ color: personalityMode === 4 ? TERM_TEXT : TERM_DIM }}
          >
            <input
              type="radio"
              name="personality"
              checked={personalityMode === 4}
              onChange={() => setPersonalityMode(4)}
              style={{ accentColor: TERM_GREEN, cursor: "pointer" }}
            />
            Custom
          </label>
        </div>
        {personalityMode === 4 && (
          <textarea
            className="ti ti-textarea mt-1.5"
            value={customPersonality}
            onChange={(e) => setCustomPersonality(e.target.value)}
            placeholder="Describe the personality..."
            rows={2}
            style={{ resize: "vertical" }}
          />
        )}
      </div>
    </TermModal>
  );
}

export default CreateAgentModal;
