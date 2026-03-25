export interface AgentPreset {
  palette: number;
  name: string;
  role: string;
  description: string;
  personality: string;
  isLeader?: boolean;
  /** Hidden from hire list — auto-used by review system */
  isReviewer?: boolean;
}

/** 6 built-in agent presets + 1 leader (hidden from hire list, auto-added in team mode) */
export const AGENT_PRESETS: AgentPreset[] = [
  { palette: 3, name: "Rex",    role: "Senior Developer",    description: "General-purpose dev, any language/framework",    personality: "" },
  { palette: 0, name: "Alex",   role: "Frontend Developer",  description: "UI, React/Vue/Next.js, CSS, accessibility",      personality: "" },
  { palette: 1, name: "Mia",    role: "Backend Architect",   description: "APIs, databases, system design, cloud",          personality: "" },
  { palette: 2, name: "Leo",    role: "Rapid Prototyper",    description: "MVP, proof-of-concept, fast iteration",          personality: "" },
  { palette: 4, name: "Nova",   role: "UI Designer",         description: "Design systems, spacing, color, accessibility",  personality: "" },
  { palette: 6, name: "Luna",   role: "Product Manager",     description: "PRD, prioritization, user stories, outcomes",    personality: "" },
  { palette: 5, name: "Marcus", role: "Team Lead",           description: "Creative direction, planning, delegation",       personality: "", isLeader: true },
  { palette: 7, name: "Sophie", role: "Code Reviewer",       description: "Code review, bugs, security, quality",          personality: "", isReviewer: true },
];

/** Index of the default (and mandatory) team leader preset. */
export const LEADER_PRESET_INDEX = AGENT_PRESETS.findIndex(p => p.isLeader);
