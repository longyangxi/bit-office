// ── Terminal theme system ──
export const TERM_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
export const TERM_SIZE = 12;

export type TermTheme = {
  name: string;
  accent: string;
  accentRgb: string;
  dim: string;
  text: string;
  textBright: string;
  bg: string;
  panel: string;
  surface: string;
  hover: string;
  border: string;
  borderDim: string;
  codeBg: string;
  codeText: string;
  scrollThumb: string;
  clean?: boolean; // Disable CRT textures, dot grid, glow effects
  // ── Semantic colors ──
  green: string;   // success / done
  yellow: string;  // warning / approval
  red: string;     // error / danger
  blue: string;    // info / working
  purple: string;  // secondary accent
  cyan: string;    // highlights / role name
};

export const TERM_THEMES: Record<string, TermTheme> = {
  office: {
    name: "Office",
    accent: "#c8a464",
    accentRgb: "200,164,100",
    dim: "#6e6050",
    text: "#b8ae9e",
    textBright: "#dcd4c6",
    bg: "#111010",
    panel: "#171514",
    surface: "#1e1b18",
    hover: "#262220",
    border: "#302b26",
    borderDim: "#231f1a",
    codeBg: "#13110e",
    codeText: "#907850",
    scrollThumb: "#342e26",
    clean: true,
    green: "#8aac6a",
    yellow: "#d4a850",
    red: "#c06050",
    blue: "#8a9eb0",
    purple: "#a08898",
    cyan: "#88a8a0",
  },
  "tokyo-night": {
    name: "Tokyo Night",
    accent: "#7aa2f7",
    accentRgb: "122,162,247",
    dim: "#565f89",
    text: "#a9b1d6",
    textBright: "#c0caf5",
    bg: "#0f111a",
    panel: "#0b0d14",
    surface: "#16161e",
    hover: "#1a1b26",
    border: "#2a2f3a",
    borderDim: "#1a1b26",
    codeBg: "#0b0d14",
    codeText: "#9aa5ce",
    scrollThumb: "#2a2f3a",
    clean: true,
    green: "#9ece6a",
    yellow: "#e0af68",
    red: "#f7768e",
    blue: "#7aa2f7",
    purple: "#bb9af7",
    cyan: "#7dcfff",
  },
  catppuccin: {
    name: "Catppuccin",
    accent: "#89b4fa",
    accentRgb: "137,180,250",
    dim: "#6c7086",
    text: "#bac2de",
    textBright: "#cdd6f4",
    bg: "#1e1e2e",
    panel: "#181825",
    surface: "#313244",
    hover: "#45475a",
    border: "#45475a",
    borderDim: "#313244",
    codeBg: "#181825",
    codeText: "#a6adc8",
    scrollThumb: "#45475a",
    clean: true,
    green: "#a6e3a1",
    yellow: "#f9e2af",
    red: "#f38ba8",
    blue: "#89b4fa",
    purple: "#cba6f7",
    cyan: "#94e2d5",
  },
  kanagawa: {
    name: "Kanagawa",
    accent: "#C0A36E",
    accentRgb: "192,163,110",
    dim: "#625e5a",
    text: "#c8c093",
    textBright: "#DCD7BA",
    bg: "#12120f",
    panel: "#161613",
    surface: "#1D1C19",
    hover: "#282727",
    border: "#393836",
    borderDim: "#282727",
    codeBg: "#0d0c0c",
    codeText: "#87a987",
    scrollThumb: "#393836",
    clean: true,
    green: "#98a870",
    yellow: "#c4b28a",
    red: "#c4746e",
    blue: "#9a8e78",
    purple: "#a89890",
    cyan: "#9aaa88",
  },
  everforest: {
    name: "Everforest",
    accent: "#a7c080",
    accentRgb: "167,192,128",
    dim: "#7a8478",
    text: "#d3c6aa",
    textBright: "#e5dfc9",
    bg: "#272e34",
    panel: "#232a30",
    surface: "#2d353b",
    hover: "#343f44",
    border: "#3d484d",
    borderDim: "#343f44",
    codeBg: "#232a30",
    codeText: "#7fbbb3",
    scrollThumb: "#3d484d",
    clean: true,
    green: "#a7c080",
    yellow: "#dbbc7f",
    red: "#e67e80",
    blue: "#7fbbb3",
    purple: "#d699b6",
    cyan: "#83c092",
  },
  "iceberg-dark": {
    name: "Iceberg Dark",
    accent: "#84a0c6",
    accentRgb: "132,160,198",
    dim: "#6b7089",
    text: "#c6c8d1",
    textBright: "#d2d4de",
    bg: "#161821",
    panel: "#12141b",
    surface: "#1e2132",
    hover: "#272b3d",
    border: "#333648",
    borderDim: "#1e2132",
    codeBg: "#12141b",
    codeText: "#89b8c2",
    scrollThumb: "#333648",
    clean: true,
    green: "#b4be82",
    yellow: "#e2a478",
    red: "#e27878",
    blue: "#84a0c6",
    purple: "#a093c7",
    cyan: "#89b8c2",
  },
};

// Mutable theme variables — reassigned by applyTermTheme()
// Defaults match "office" theme
export let TERM_GREEN = "#c8a464";
export let TERM_DIM = "#6e6050";
export let TERM_TEXT = "#b8ae9e";
export let TERM_TEXT_BRIGHT = "#dcd4c6";
export let TERM_ERROR = "#c06050";
export let TERM_GLOW = "none";
export let TERM_BG = "#111010";
export let TERM_PANEL = "#171514";
export let TERM_SURFACE = "#1e1b18";
export let TERM_HOVER = "#262220";
export let TERM_BORDER = "#302b26";
export let TERM_BORDER_DIM = "#231f1a";
export let TERM_GLOW_BORDER = "none";
export let TERM_GLOW_FOCUS = "none";
// Semantic color exports
export let TERM_SEM_GREEN = "#8aac6a";
export let TERM_SEM_YELLOW = "#d4a850";
export let TERM_SEM_RED = "#c06050";
export let TERM_SEM_BLUE = "#8a9eb0";
export let TERM_SEM_PURPLE = "#a08898";
export let TERM_SEM_CYAN = "#88a8a0";

export function applyTermTheme(key: string) {
  const t = TERM_THEMES[key] ?? TERM_THEMES["office"];
  TERM_GREEN = t.accent;
  TERM_DIM = t.dim;
  TERM_TEXT = t.text;
  TERM_TEXT_BRIGHT = t.textBright;
  TERM_ERROR = t.red;
  TERM_BG = t.bg;
  TERM_PANEL = t.panel;
  TERM_SURFACE = t.surface;
  TERM_HOVER = t.hover;
  TERM_BORDER = t.border;
  TERM_BORDER_DIM = t.borderDim;
  // All themes are clean — no glow effects
  TERM_GLOW = t.clean ? "none" : `0 0 8px rgba(${t.accentRgb},0.25)`;
  TERM_GLOW_BORDER = t.clean ? "none" : `0 0 6px ${t.accent}15, inset 0 0 6px ${t.accent}08`;
  TERM_GLOW_FOCUS = t.clean ? "none" : `0 0 12px ${t.accent}30, 0 0 4px ${t.accent}20`;
  // Semantic colors
  TERM_SEM_GREEN = t.green;
  TERM_SEM_YELLOW = t.yellow;
  TERM_SEM_RED = t.red;
  TERM_SEM_BLUE = t.blue;
  TERM_SEM_PURPLE = t.purple;
  TERM_SEM_CYAN = t.cyan;
  // Update CSS variables for layout.tsx CSS rules
  if (typeof document !== "undefined") {
    const s = document.documentElement.style;
    s.setProperty("--term-bg", t.bg);
    s.setProperty("--term-panel", t.panel);
    s.setProperty("--term-card", t.surface);
    s.setProperty("--term-surface", t.surface);
    s.setProperty("--term-border", t.border);
    s.setProperty("--term-border-dim", t.borderDim);
    s.setProperty("--term-green", t.accent);
    s.setProperty("--term-green-dim", t.dim);
    s.setProperty("--term-text", t.text);
    s.setProperty("--term-text-bright", t.textBright);
    s.setProperty("--term-accent-rgb", t.accentRgb);
    s.setProperty("--term-code-bg", t.codeBg);
    s.setProperty("--term-code-text", t.codeText);
    s.setProperty("--term-scroll-thumb", t.scrollThumb);
    s.setProperty("--term-clean", t.clean ? "1" : "0");
    // Semantic CSS vars
    s.setProperty("--term-sem-green", t.green);
    s.setProperty("--term-sem-yellow", t.yellow);
    s.setProperty("--term-sem-red", t.red);
    s.setProperty("--term-sem-blue", t.blue);
    s.setProperty("--term-sem-purple", t.purple);
    s.setProperty("--term-sem-cyan", t.cyan);
    // Toggle clean mode class on root for CSS selectors
    if (t.clean) {
      document.documentElement.classList.add("term-clean");
    } else {
      document.documentElement.classList.remove("term-clean");
    }
  }
}
