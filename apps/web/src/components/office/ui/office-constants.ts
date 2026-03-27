/** Role catalog: category > agents for Create Agent role picker */
export type RoleCatalogAgent = { name: string; desc: string };
export type RoleCatalogCategory = { category: string; label: string; agents: RoleCatalogAgent[] };

import { TERM_DIM, TERM_SEM_BLUE, TERM_SEM_YELLOW, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme";

/** Status colors are derived from the active theme's semantic palette */
export function getStatusConfig(): Record<string, { color: string; label: string }> {
  return {
    idle: { color: TERM_DIM, label: "Idle" },
    working: { color: TERM_SEM_BLUE, label: "Working..." },
    waiting_approval: { color: TERM_SEM_YELLOW, label: "Needs Approval" },
    done: { color: TERM_SEM_GREEN, label: "Done" },
    error: { color: TERM_SEM_RED, label: "Error" },
  };
}
// Keep a static default for backward compat (components should prefer getStatusConfig())
export const STATUS_CONFIG = getStatusConfig();

export const RATING_DIMENSIONS = [
  { key: "creativity", label: "Creativity", icon: "✦" },
  { key: "visual", label: "Visual", icon: "◈" },
  { key: "interaction", label: "Interaction", icon: "⚡" },
  { key: "completeness", label: "Completeness", icon: "●" },
  { key: "engagement", label: "Engagement", icon: "♥" },
] as const;

export type RatingKey = (typeof RATING_DIMENSIONS)[number]["key"];
export type Ratings = Partial<Record<RatingKey, number>>;

export const BACKEND_OPTIONS = [
  { id: "claude", name: "Claude", color: "#d97706" },
  { id: "codex", name: "Codex", color: "#a855f7" },
  { id: "gemini", name: "Gemini", color: "#3b82f6" },
  { id: "aider", name: "Aider", color: "#22c55e" },
  { id: "opencode", name: "OpenCode", color: "#06b6d4" },
];

export const PERSONALITY_PRESETS = [
  { label: "Friendly & Casual", value: "You speak in a friendly, casual, encouraging, and natural tone." },
  { label: "Professional & Concise", value: "You speak formally, professionally, in an organized and concise manner." },
  { label: "Aggressive & Fast", value: "You are aggressive, action-first, always pursuing speed and efficiency." },
];

/** Roles available in Create Agent picker, organized by category.
 *  Built-in preset roles (from AGENT_PRESETS) are excluded — they're in the quick-hire list. */
export const ROLE_CATALOG: RoleCatalogCategory[] = [
  { category: "dev", label: "Development", agents: [
    { name: "Software Architect", desc: "System design, domain-driven design, architectural patterns" },
    { name: "UX Architect", desc: "UX foundations, CSS systems, layout, component architecture" },
  ]},
  { category: "game", label: "Game Dev", agents: [
    { name: "Game Designer", desc: "Gameplay loops, economy balancing, GDD authorship" },
    { name: "Level Designer", desc: "Spatial storytelling, pacing, encounter design" },
    { name: "Narrative Designer", desc: "Branching dialogue, lore architecture, environmental storytelling" },
    { name: "Game Audio Engineer", desc: "FMOD/Wwise, adaptive music, spatial audio" },
    { name: "Unity Developer", desc: "Unity engine, C#, ScriptableObjects, ECS" },
    { name: "Godot Developer", desc: "Godot 4, GDScript, node-based architecture" },
    { name: "Three.js Developer", desc: "3D web graphics, WebGL, shaders, scene management" },
    { name: "PixiJS Developer", desc: "2D web graphics, sprites, particle systems, WebGL" },
  ]},
  { category: "other", label: "Specialist", agents: [
    { name: "QA Engineer", desc: "Test strategy, test pyramid, edge case analysis" },
    { name: "SRE (Site Reliability Engineer)", desc: "SLOs, error budgets, observability, toil reduction" },
    { name: "Security Engineer", desc: "Threat modeling, OWASP, STRIDE, secure code review" },
    { name: "DevOps Engineer", desc: "CI/CD pipelines, deployment strategies, infrastructure as code" },
    { name: "Technical Writer", desc: "API docs, README structure, changelog format" },
    { name: "Data Engineer", desc: "Schema design, migrations, ETL pipelines, data quality" },
  ]},
];

export function getPhaseInfo(): Record<string, { color: string; icon: string; hint: string }> {
  return {
    create: { color: TERM_SEM_BLUE, icon: "\uD83D\uDCAC", hint: "Chat with your team lead to define the project" },
    design: { color: TERM_SEM_YELLOW, icon: "\uD83D\uDCCB", hint: "Review the plan \u2014 approve it or give feedback" },
    execute: { color: TERM_SEM_YELLOW, icon: "\u26A1", hint: "Team is building your project" },
    complete: { color: TERM_SEM_GREEN, icon: "\u2713", hint: "Review results \u2014 give feedback or end project" },
  };
}

/** Flat lookup: role name -> description */
export const ROLE_DESC_MAP = new Map<string, string>();
for (const cat of ROLE_CATALOG) {
  for (const a of cat.agents) {
    ROLE_DESC_MAP.set(a.name, a.desc);
  }
}

/** Flat list of all role names (for index-based compat) */
export const ROLE_PRESETS = ROLE_CATALOG.flatMap((c) => c.agents.map((a) => a.name));
