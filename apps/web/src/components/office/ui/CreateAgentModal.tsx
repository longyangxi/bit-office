"use client";

import { useState, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { ROLE_PRESETS, SKILLS_MAP, AGENCY_CATALOG, AGENCY_AGENT_MAP, PERSONALITY_PRESETS } from "./office-constants";
import { TERM_PANEL } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import { isRealEnter } from "./office-utils";

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
    ? AGENCY_CATALOG.map((cat) => ({
        ...cat,
        subcategories: cat.subcategories.map((sub) => ({
          ...sub,
          agents: sub.agents.filter((a) =>
            a.name.toLowerCase().includes(query) || a.desc.toLowerCase().includes(query) || cat.label.toLowerCase().includes(query)
          ),
        })).filter((sub) => sub.agents.length > 0),
      })).filter((cat) => cat.subcategories.length > 0)
    : AGENCY_CATALOG;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 14, fontFamily: "monospace",
    border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
    boxSizing: "border-box",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={open ? search : value}
        onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(""); }}
        placeholder="Search roles..."
        style={inputStyle}
      />
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          maxHeight: 250, overflowY: "auto", backgroundColor: "#14112a",
          border: "1px solid #1a2a1a", borderTop: "none",
        }}>
          {filtered.map((cat) =>
            cat.subcategories.map((sub) => (
              <div key={`${cat.category}/${sub.name}`}>
                <div style={{
                  padding: "4px 10px", fontSize: 10, color: "#5a4838",
                  fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em",
                  backgroundColor: "#0a0e0a", position: "sticky", top: 0,
                }}>
                  {cat.subcategories.length > 1 && sub.name !== "_root" ? `${cat.label} > ${sub.label}` : cat.label}
                </div>
                {sub.agents.map((a) => (
                  <div
                    key={a.name}
                    onClick={() => { onSelect(a.name); setOpen(false); setSearch(""); }}
                    style={{
                      padding: "5px 10px", fontSize: 13, fontFamily: "monospace",
                      color: a.name === value ? "#e8b040" : "#eddcb8",
                      cursor: "pointer", backgroundColor: a.name === value ? "#382800" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = "#1a1a2a"; }}
                    onMouseLeave={(e) => { if (a.name !== value) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    {a.name}
                  </div>
                ))}
              </div>
            ))
          )}
          {filtered.length === 0 && (
            <div
              onClick={() => { onSelect(search.trim()); setOpen(false); setSearch(""); }}
              style={{ padding: "8px 10px", fontSize: 13, fontFamily: "monospace", color: "#7a6858", cursor: "pointer" }}
            >
              Use custom: &quot;{search.trim()}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateAgentModal({ onSave, onClose, assetsReady, editAgent }: {
  onSave: (agent: AgentDefinition) => void;
  onClose: () => void;
  assetsReady?: boolean;
  editAgent?: AgentDefinition | null;
}) {
  const [palette, setPalette] = useState(editAgent?.palette ?? Math.floor(Math.random() * 6));
  const [name, setName] = useState(editAgent?.name ?? (() => {
    const names = ["Alex", "Sam", "Max", "Leo", "Mia", "Kai", "Zoe", "Eli", "Ava", "Jay", "Rio", "Ash", "Sky", "Kit", "Noa", "Rex", "Ivy", "Ace", "Ren", "Jax"];
    return names[Math.floor(Math.random() * names.length)];
  })());

  // Role: preset index (-1 = custom)
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

  // Skills: set of selected tags
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => {
    if (!editAgent?.skills) return new Set(SKILLS_MAP[ROLE_PRESETS[0]]?.slice(0, 4) ?? []);
    return new Set(editAgent.skills.split(",").map((s) => s.trim()).filter(Boolean));
  });
  const [customSkillInput, setCustomSkillInput] = useState("");

  const currentRole = rolePresetIndex >= 0 ? ROLE_PRESETS[rolePresetIndex] : customRole.trim();
  const suggestedSkills = rolePresetIndex >= 0 ? (SKILLS_MAP[ROLE_PRESETS[rolePresetIndex]] ?? []) : [];

  const handleRoleChange = (idx: number) => {
    setRolePresetIndex(idx);
    if (idx >= 0) {
      const preset = ROLE_PRESETS[idx];
      const suggested = SKILLS_MAP[preset] ?? [];
      // Auto-select first 4 if no matching skills already selected
      const hasMatching = suggested.some((s) => selectedSkills.has(s));
      if (!hasMatching) {
        setSelectedSkills(new Set(suggested.slice(0, 4)));
      }
    }
  };

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const addCustomSkill = () => {
    const skill = customSkillInput.trim();
    if (skill && !selectedSkills.has(skill)) {
      setSelectedSkills((prev) => new Set(prev).add(skill));
      setCustomSkillInput("");
    }
  };

  const [personalityMode, setPersonalityMode] = useState<number>(() => {
    if (!editAgent) return 0;
    const idx = PERSONALITY_PRESETS.findIndex((p) => p.value === editAgent.personality);
    return idx >= 0 ? idx : 4; // 4 = custom
  });
  const [customPersonality, setCustomPersonality] = useState(editAgent?.personality ?? "");

  const currentPersonality = personalityMode < 4
    ? PERSONALITY_PRESETS[personalityMode].value
    : customPersonality;

  const handleSave = () => {
    if (!name.trim()) return;
    const id = editAgent
      ? editAgent.id
      : (name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "agent") + `-${nanoid(4)}`;
    onSave({
      id,
      name: name.trim(),
      role: currentRole,
      skills: Array.from(selectedSkills).join(", "),
      personality: currentPersonality,
      palette,
      isBuiltin: editAgent?.isBuiltin ?? false,
      teamRole: editAgent?.teamRole ?? "dev",
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: TERM_PANEL, padding: "18px 18px 14px",
          width: "90%", maxWidth: 400, border: "2px solid #1a2a1a",
          boxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 className="px-font" style={{ fontSize: 14, margin: "0 0 12px", textAlign: "center", color: "#e8b040", letterSpacing: "0.05em" }}>
          {editAgent ? "Edit Agent" : "Create Agent"}
        </h2>

        {/* Avatar palette selector */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>AVATAR</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                onClick={() => setPalette(p)}
                style={{
                  padding: 3, border: palette === p ? "2px solid #e8b040" : "2px solid #1a2a1a",
                  backgroundColor: palette === p ? "#382800" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <SpriteAvatar palette={p} zoom={2} ready={assetsReady} />
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>NAME</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
            style={{
              width: "100%", padding: "7px 10px", fontSize: 14, fontFamily: "monospace",
              border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Role — searchable dropdown */}
        <div style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>ROLE</div>
          <RoleSearchSelect
            value={currentRole}
            onSelect={(roleName) => {
              const idx = ROLE_PRESETS.indexOf(roleName);
              if (idx >= 0) {
                handleRoleChange(idx);
              } else {
                // Custom role
                setRolePresetIndex(-1);
                setCustomRole(roleName);
              }
            }}
          />
          {AGENCY_AGENT_MAP.get(currentRole) && (
            <div style={{ fontSize: 11, color: "#5a4838", marginTop: 4, fontFamily: "monospace", lineHeight: 1.4 }}>
              {AGENCY_AGENT_MAP.get(currentRole)}
            </div>
          )}
        </div>

        {/* Skills */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>SKILLS</div>
          {/* Suggested skill chips */}
          {suggestedSkills.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {suggestedSkills.map((skill) => {
                const active = selectedSkills.has(skill);
                return (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    style={{
                      padding: "4px 10px", fontSize: 13, fontFamily: "monospace",
                      border: active ? "1px solid #e8b04080" : "1px solid #1a2a1a",
                      backgroundColor: active ? "#382800" : "transparent",
                      color: active ? "#e8b040" : "#7a6858",
                      cursor: "pointer",
                    }}
                  >{skill}</button>
                );
              })}
            </div>
          )}
          {/* Custom-added skills (not in suggested) */}
          {(() => {
            const customTags = Array.from(selectedSkills).filter((s) => !suggestedSkills.includes(s));
            if (customTags.length === 0) return null;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {customTags.map((skill) => (
                  <span
                    key={skill}
                    style={{
                      padding: "4px 10px", fontSize: 13, fontFamily: "monospace",
                      border: "1px solid #5aacff60", backgroundColor: "#182844",
                      color: "#5aacff", display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {skill}
                    <span
                      onClick={() => toggleSkill(skill)}
                      style={{ cursor: "pointer", fontSize: 15, lineHeight: 1, color: "#5aacff80" }}
                    >&times;</span>
                  </span>
                ))}
              </div>
            );
          })()}
          {/* Add custom skill */}
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={customSkillInput}
              onChange={(e) => setCustomSkillInput(e.target.value)}
              onKeyDown={(e) => { if (isRealEnter(e)) { e.preventDefault(); addCustomSkill(); } }}
              placeholder="Add custom skill..."
              style={{
                flex: 1, padding: "6px 10px", fontSize: 13, fontFamily: "monospace",
                border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={addCustomSkill}
              style={{
                padding: "5px 12px", fontSize: 15, fontWeight: 700,
                border: "1px solid #1a2a1a", backgroundColor: "transparent",
                color: "#7a6858", cursor: "pointer", fontFamily: "monospace",
              }}
            >+</button>
          </div>
        </div>

        {/* Personality */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#7a6858", marginBottom: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>PERSONALITY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {PERSONALITY_PRESETS.map((p, i) => (
              <label
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                  cursor: "pointer", fontSize: 13, color: personalityMode === i ? "#eddcb8" : "#7a6858",
                  fontFamily: "monospace",
                }}
              >
                <input
                  type="radio"
                  name="personality"
                  checked={personalityMode === i}
                  onChange={() => setPersonalityMode(i)}
                  style={{ accentColor: "#e8b040", cursor: "pointer" }}
                />
                {p.label}
              </label>
            ))}
            <label
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                cursor: "pointer", fontSize: 13, color: personalityMode === 4 ? "#eddcb8" : "#7a6858",
                fontFamily: "monospace",
              }}
            >
              <input
                type="radio"
                name="personality"
                checked={personalityMode === 4}
                onChange={() => setPersonalityMode(4)}
                style={{ accentColor: "#e8b040", cursor: "pointer" }}
              />
              Custom
            </label>
            {personalityMode === 4 && (
              <textarea
                value={customPersonality}
                onChange={(e) => setCustomPersonality(e.target.value)}
                placeholder="Describe the personality..."
                rows={2}
                style={{
                  width: "100%", padding: "7px 10px", fontSize: 13, fontFamily: "monospace",
                  border: "1px solid #1a2a1a", backgroundColor: "#14112a", color: "#eddcb8",
                  resize: "vertical", boxSizing: "border-box", marginTop: 2,
                }}
              />
            )}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleSave}
            style={{
              flex: 1, padding: "9px", border: "1px solid #e8b04060",
              backgroundColor: "#382800", color: "#e8b040", fontSize: 14,
              fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              opacity: name.trim() ? 1 : 0.4,
            }}
            disabled={!name.trim()}
          >
            {editAgent ? "Save" : "Create"}
          </button>
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

export default CreateAgentModal;
