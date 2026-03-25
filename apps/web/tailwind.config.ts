import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /* ── Terminal Design Tokens ──
         Map existing CSS custom properties so Tailwind utilities
         can reference the terminal palette without duplication. */
      colors: {
        // shadcn semantic slots — wired to terminal vars
        border: "var(--term-border)",
        input: "var(--term-border)",
        ring: "var(--term-green)",
        background: "var(--term-bg)",
        foreground: "var(--term-text)",
        primary: {
          DEFAULT: "var(--term-sem-green)",
          foreground: "var(--term-bg)",
        },
        secondary: {
          DEFAULT: "var(--term-panel)",
          foreground: "var(--term-text)",
        },
        destructive: {
          DEFAULT: "var(--term-sem-red)",
          foreground: "var(--term-bg)",
        },
        muted: {
          DEFAULT: "var(--term-surface)",
          foreground: "var(--term-green-dim)",
        },
        accent: {
          DEFAULT: "var(--term-accent)",
          foreground: "var(--term-bg)",
        },
        popover: {
          DEFAULT: "var(--term-panel)",
          foreground: "var(--term-text)",
        },
        card: {
          DEFAULT: "var(--term-card)",
          foreground: "var(--term-text)",
        },

        // Semantic status colors
        sem: {
          green: "var(--term-sem-green)",
          yellow: "var(--term-sem-yellow)",
          red: "var(--term-sem-red)",
          blue: "var(--term-sem-blue)",
          purple: "var(--term-sem-purple)",
          cyan: "var(--term-sem-cyan)",
        },

        // Terminal palette — direct access
        term: {
          bg: "var(--term-bg)",
          panel: "var(--term-panel)",
          card: "var(--term-card)",
          surface: "var(--term-surface)",
          border: "var(--term-border)",
          "border-dim": "var(--term-border-dim)",
          green: "var(--term-green)",
          "green-dim": "var(--term-green-dim)",
          text: "var(--term-text)",
          "text-bright": "var(--term-text-bright)",
        },

        // Office scene palette
        office: {
          bg: "var(--office-bg)",
          panel: "var(--office-panel)",
          border: "var(--office-border)",
          text: "var(--office-text)",
          gold: "var(--office-gold)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "Consolas", "monospace"],
        pixel: ["Press Start 2P", "monospace"],
      },
      fontSize: {
        term: ["12px", { lineHeight: "1.7" }],
      },
      spacing: {
        // Map design token spacing (already in global.css as --space-*)
        "space-1": "var(--space-1)",
        "space-2": "var(--space-2)",
        "space-3": "var(--space-3)",
        "space-4": "var(--space-4)",
        "space-5": "var(--space-5)",
        "space-6": "var(--space-6)",
        "space-8": "var(--space-8)",
        "space-10": "var(--space-10)",
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        inset: "var(--shadow-inset)",
        "inset-deep": "var(--shadow-inset-deep)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        "ease-out-expo": "var(--ease-out)",
        "ease-in-out-custom": "var(--ease-in-out)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
