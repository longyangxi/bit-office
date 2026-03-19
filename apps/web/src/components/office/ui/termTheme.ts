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
    green: "#18ff62",
    yellow: "#e8c840",
    red: "#ff6b6b",
    blue: "#5aacff",
    purple: "#c084fc",
    cyan: "#40e8d0",
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
  gruvbox: {
    name: "Gruvbox",
    accent: "#fabd2f",
    accentRgb: "250,189,47",
    dim: "#a89984",
    text: "#d5c4a1",
    textBright: "#ebdbb2",
    bg: "#282828",
    panel: "#1f1f1f",
    surface: "#3c3836",
    hover: "#504945",
    border: "#504945",
    borderDim: "#3c3836",
    codeBg: "#1f1f1f",
    codeText: "#a89984",
    scrollThumb: "#504945",
    clean: true,
    green: "#b8bb26",
    yellow: "#fabd2f",
    red: "#fb4934",
    blue: "#83a598",
    purple: "#d3869b",
    cyan: "#83a598",
  },
  nord: {
    name: "Nord",
    accent: "#88c0d0",
    accentRgb: "136,192,208",
    dim: "#616e88",
    text: "#d8dee9",
    textBright: "#eceff4",
    bg: "#2e3440",
    panel: "#272c36",
    surface: "#3b4252",
    hover: "#434c5e",
    border: "#4c566a",
    borderDim: "#3b4252",
    codeBg: "#272c36",
    codeText: "#81a1c1",
    scrollThumb: "#4c566a",
    clean: true,
    green: "#a3be8c",
    yellow: "#ebcb8b",
    red: "#bf616a",
    blue: "#5e81ac",
    purple: "#b48ead",
    cyan: "#88c0d0",
  },
  dracula: {
    name: "Dracula",
    accent: "#bd93f9",
    accentRgb: "189,147,249",
    dim: "#7a84b0",
    text: "#c0c8e8",
    textBright: "#f8f8f2",
    bg: "#282a36",
    panel: "#232530",
    surface: "#44475a",
    hover: "#4d5066",
    border: "#6272a4",
    borderDim: "#44475a",
    codeBg: "#232530",
    codeText: "#6272a4",
    scrollThumb: "#6272a4",
    clean: true,
    green: "#50fa7b",
    yellow: "#f1fa8c",
    red: "#ff5555",
    blue: "#8be9fd",
    purple: "#bd93f9",
    cyan: "#8be9fd",
  },
  monokai: {
    name: "Monokai",
    accent: "#a6e22e",
    accentRgb: "166,226,46",
    dim: "#7a8a48",
    text: "#c8d888",
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
    clean: true,
    green: "#a6e22e",
    yellow: "#e6db74",
    red: "#f92672",
    blue: "#66d9ef",
    purple: "#ae81ff",
    cyan: "#66d9ef",
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
    green: "#87a987",
    yellow: "#c4b28a",
    red: "#c4746e",
    blue: "#8ba4b0",
    purple: "#a292a3",
    cyan: "#8ea4a2",
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
    green: "#7ab87a",
    yellow: "#d4a850",
    red: "#c06050",
    blue: "#6a9ec0",
    purple: "#a888b8",
    cyan: "#70b0a8",
  },
  "black-metal": {
    name: "Black Metal",
    accent: "#dd9999",
    accentRgb: "221,153,153",
    dim: "#486e6f",
    text: "#c1c1c1",
    textBright: "#e0e0e0",
    bg: "#000000",
    panel: "#0a0a0a",
    surface: "#141414",
    hover: "#1c1c1c",
    border: "#2a2a2a",
    borderDim: "#1a1a1a",
    codeBg: "#080808",
    codeText: "#a06666",
    scrollThumb: "#2a2a2a",
    clean: true,
    green: "#486e6f",
    yellow: "#a06666",
    red: "#dd9999",
    blue: "#888888",
    purple: "#999999",
    cyan: "#aaaaaa",
  },
  "atom-one-dark": {
    name: "Atom One Dark",
    accent: "#61afef",
    accentRgb: "97,175,239",
    dim: "#5c6370",
    text: "#abb2bf",
    textBright: "#d7dae0",
    bg: "#21252b",
    panel: "#1e2227",
    surface: "#282c34",
    hover: "#323844",
    border: "#3e4451",
    borderDim: "#282c34",
    codeBg: "#1e2227",
    codeText: "#98c379",
    scrollThumb: "#3e4451",
    clean: true,
    green: "#98c379",
    yellow: "#e5c07b",
    red: "#e06c75",
    blue: "#61afef",
    purple: "#c678dd",
    cyan: "#56b6c2",
  },
  owl: {
    name: "Owl",
    accent: "#da5b2c",
    accentRgb: "218,91,44",
    dim: "#5d595b",
    text: "#dedede",
    textBright: "#ffffff",
    bg: "#2f2b2c",
    panel: "#292526",
    surface: "#383434",
    hover: "#433e3f",
    border: "#4a4546",
    borderDim: "#383434",
    codeBg: "#292526",
    codeText: "#b1b1b1",
    scrollThumb: "#4a4546",
    clean: true,
    green: "#989898",
    yellow: "#cacaca",
    red: "#da5b2c",
    blue: "#656565",
    purple: "#b1b1b1",
    cyan: "#7f7f7f",
  },
  vague: {
    name: "Vague",
    accent: "#aeaed1",
    accentRgb: "174,174,209",
    dim: "#606079",
    text: "#cdcdcd",
    textBright: "#d7d7d7",
    bg: "#141415",
    panel: "#111112",
    surface: "#1e1e24",
    hover: "#252530",
    border: "#2e2e3a",
    borderDim: "#1e1e24",
    codeBg: "#111112",
    codeText: "#8ba9c1",
    scrollThumb: "#2e2e3a",
    clean: true,
    green: "#7fa563",
    yellow: "#f3be7c",
    red: "#d8647e",
    blue: "#6e94b2",
    purple: "#bb9dbd",
    cyan: "#aeaed1",
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
  slate: {
    name: "Slate",
    accent: "#6aaddf",
    accentRgb: "106,173,223",
    dim: "#606878",
    text: "#c0c8d4",
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
    green: "#48cc6a",
    yellow: "#e8b040",
    red: "#e04848",
    blue: "#6aaddf",
    purple: "#a78bfa",
    cyan: "#5ec4d0",
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
export let TERM_SEM_GREEN = "#7ab87a";
export let TERM_SEM_YELLOW = "#d4a850";
export let TERM_SEM_RED = "#c06050";
export let TERM_SEM_BLUE = "#6a9ec0";
export let TERM_SEM_PURPLE = "#a888b8";
export let TERM_SEM_CYAN = "#70b0a8";

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
