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
};

export const TERM_THEMES: Record<string, TermTheme> = {
  "green-hacker": {
    name: "Green Hacker",
    accent: "#18ff62",
    accentRgb: "24,255,98",
    dim: "#5a7a5a",
    text: "#9aba9a",
    textBright: "#c8e0c0",
    bg: "#050808",
    panel: "#0c1210",
    surface: "#0a0e0a",
    hover: "#0e1a0e",
    border: "#1a2a1a",
    borderDim: "#152515",
    codeBg: "#060810",
    codeText: "#6a8a6a",
    scrollThumb: "#1a3a1a",
  },
  "tokyo-night": {
    name: "Tokyo Night",
    accent: "#7aa2f7",
    accentRgb: "122,162,247",
    dim: "#6070a0",
    text: "#95a0cc",
    textBright: "#d0d8f8",
    bg: "#1a1b26",
    panel: "#16161e",
    surface: "#1c1e2e",
    hover: "#242840",
    border: "#2d3460",
    borderDim: "#252a4a",
    codeBg: "#151620",
    codeText: "#6670a8",
    scrollThumb: "#2d3460",
  },
  dracula: {
    name: "Dracula",
    accent: "#bd93f9",
    accentRgb: "189,147,249",
    dim: "#7268a0",
    text: "#a898e0",
    textBright: "#f0eaff",
    bg: "#1c1b2e",
    panel: "#22213a",
    surface: "#282840",
    hover: "#302e50",
    border: "#3e3a68",
    borderDim: "#332f58",
    codeBg: "#1a1928",
    codeText: "#7a6eb8",
    scrollThumb: "#3e3a68",
  },
  nord: {
    name: "Nord",
    accent: "#88c0d0",
    accentRgb: "136,192,208",
    dim: "#6888a0",
    text: "#9ac0d4",
    textBright: "#e0f0f8",
    bg: "#1c2028",
    panel: "#222830",
    surface: "#262e38",
    hover: "#2e3a48",
    border: "#344858",
    borderDim: "#2e3e4e",
    codeBg: "#1a2028",
    codeText: "#6a94a8",
    scrollThumb: "#344858",
  },
  monokai: {
    name: "Monokai",
    accent: "#a6e22e",
    accentRgb: "166,226,46",
    dim: "#7a8a48",
    text: "#a8c068",
    textBright: "#e8f0c8",
    bg: "#1a1c14",
    panel: "#22241a",
    surface: "#282a20",
    hover: "#343828",
    border: "#3e4430",
    borderDim: "#343828",
    codeBg: "#181a12",
    codeText: "#7a9040",
    scrollThumb: "#3e4430",
  },
  office: {
    name: "Office",
    accent: "#d4a860",
    accentRgb: "212,168,96",
    dim: "#685848",
    text: "#b8a898",
    textBright: "#e0d4c8",
    bg: "#141218",
    panel: "#1a1820",
    surface: "#201e28",
    hover: "#282430",
    border: "#302a38",
    borderDim: "#262030",
    codeBg: "#18161e",
    codeText: "#a08858",
    scrollThumb: "#383040",
    clean: true,
  },
  slate: {
    name: "Slate",
    accent: "#6aaddf",
    accentRgb: "106,173,223",
    dim: "#606878",
    text: "#b0b8c4",
    textBright: "#d8dce4",
    bg: "#1e2228",
    panel: "#232830",
    surface: "#282e36",
    hover: "#303840",
    border: "#384048",
    borderDim: "#303840",
    codeBg: "#1c2026",
    codeText: "#70a0c8",
    scrollThumb: "#384450",
    clean: true,
  },
};

// Mutable theme variables — reassigned by applyTermTheme()
export let TERM_GREEN = "#18ff62";
export let TERM_DIM = "#5a7a5a";
export let TERM_TEXT = "#9aba9a";
export let TERM_TEXT_BRIGHT = "#c8e0c0";
export let TERM_ERROR = "#ff6b6b";
export let TERM_GLOW = "0 0 8px rgba(24,255,98,0.25)";
export let TERM_BG = "#050808";
export let TERM_PANEL = "#0c1210";
export let TERM_SURFACE = "#0a0e0a";
export let TERM_HOVER = "#0e1a0e";
export let TERM_BORDER = "#1a2a1a";
export let TERM_BORDER_DIM = "#152515";
export let TERM_GLOW_BORDER = `0 0 6px ${TERM_GREEN}15, inset 0 0 6px ${TERM_GREEN}08`;
export let TERM_GLOW_FOCUS = `0 0 12px ${TERM_GREEN}30, 0 0 4px ${TERM_GREEN}20`;

export function applyTermTheme(key: string) {
  const t = TERM_THEMES[key] ?? TERM_THEMES["green-hacker"];
  TERM_GREEN = t.accent;
  TERM_DIM = t.dim;
  TERM_TEXT = t.text;
  TERM_TEXT_BRIGHT = t.textBright;
  TERM_BG = t.bg;
  TERM_PANEL = t.panel;
  TERM_SURFACE = t.surface;
  TERM_HOVER = t.hover;
  TERM_BORDER = t.border;
  TERM_BORDER_DIM = t.borderDim;
  TERM_GLOW = t.clean ? "none" : `0 0 8px rgba(${t.accentRgb},0.25)`;
  TERM_GLOW_BORDER = t.clean ? "none" : `0 0 6px ${t.accent}15, inset 0 0 6px ${t.accent}08`;
  TERM_GLOW_FOCUS = t.clean ? "none" : `0 0 12px ${t.accent}30, 0 0 4px ${t.accent}20`;
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
    // Toggle clean mode class on root for CSS selectors
    if (t.clean) {
      document.documentElement.classList.add("term-clean");
    } else {
      document.documentElement.classList.remove("term-clean");
    }
  }
}
