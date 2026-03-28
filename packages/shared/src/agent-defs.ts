export interface AgentDefinition {
  id: string;             // Unique identifier (e.g. "alex", "my-python-bot")
  name: string;           // Display name (e.g. "Alex", "小明")
  role: string;           // Short role title — used for --agent resolution against bundled agents
  skills: string;         // Specialty description (e.g. "React/Next.js/CSS")
  personality: string;    // Personality text, injected into prompt
  palette: number;        // Avatar palette index (0-7)
  isBuiltin: boolean;     // true = shipped with app, editable but not deletable
  teamRole: "dev" | "reviewer" | "leader";  // What team slot this agent can fill
  skillFiles?: string[];  // Skill file names in ~/.open-office/skills/ (e.g. ["tdd", "react-patterns"])
  canDelegate?: boolean;  // Override: allow this agent to delegate tasks via @Name (default: derived from role)
  noCode?: boolean;       // Override: prevent this agent from writing code (default: derived from role)
}

/** Metadata for a skill stored in ~/.open-office[-dev]/skills/ */
export interface SkillMeta {
  name: string;           // Directory or file name (without .md extension)
  title: string;          // Display title (first heading or name)
  isFolder: boolean;      // true = folder with skill.md, false = single .md file
}

export const DEFAULT_AGENT_DEFS: AgentDefinition[] = [
  // ── Hire list (6 presets) ──
  { id: "rex",    name: "Rex",    role: "Senior Developer",    skills: "General-purpose dev, any language/framework",               personality: "", palette: 3, isBuiltin: true, teamRole: "dev" },
  { id: "alex",   name: "Alex",   role: "Frontend Developer",  skills: "UI, React/Vue/Next.js, CSS, accessibility",                personality: "", palette: 0, isBuiltin: true, teamRole: "dev" },
  { id: "mia",    name: "Mia",    role: "Backend Architect",   skills: "APIs, databases, system design, cloud",                    personality: "", palette: 1, isBuiltin: true, teamRole: "dev" },
  { id: "leo",    name: "Leo",    role: "Rapid Prototyper",    skills: "MVP, proof-of-concept, fast iteration",                    personality: "", palette: 2, isBuiltin: true, teamRole: "dev" },
  { id: "nova",   name: "Nova",   role: "UI Designer",         skills: "Design systems, spacing, color, accessibility",            personality: "", palette: 4, isBuiltin: true, teamRole: "dev" },
  { id: "luna",   name: "Luna",   role: "Product Manager",     skills: "PRD, prioritization, user stories, outcomes",              personality: "", palette: 6, isBuiltin: true, teamRole: "dev" },
  // ── Hidden (auto-assigned, not in hire list) ──
  { id: "marcus", name: "Marcus", role: "Team Lead",           skills: "Creative direction, planning, delegation",                 personality: "", palette: 5, isBuiltin: true, teamRole: "leader" },
  { id: "sophie", name: "Sophie", role: "Code Reviewer",       skills: "Code review, bugs, security, quality",                    personality: "", palette: 7, isBuiltin: true, teamRole: "reviewer" },
];
