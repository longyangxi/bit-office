import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bit Office",
  description: "Control your AI agents from anywhere",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#1a1530" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&family=Press+Start+2P&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, backgroundColor: "#16122a", color: "#eddcb8", fontFamily: "system-ui, sans-serif" }}>
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            /* ── Office scene (pixel art, warm purple) ── */
            --office-bg: #16122a;
            --office-panel: #1e1a30;
            --office-border: #3d2e54;
            --office-text: #eddcb8;
            --office-gold: #e8b040;

            /* ── Console/chat (terminal, dark green-black) ── */
            --term-bg: #050808;
            --term-panel: #0c1210;
            --term-card: #0e160e;
            --term-surface: #0a0e0a;
            --term-border: #1a2a1a;
            --term-border-dim: #152515;
            --term-green: #18ff62;
            --term-green-dim: #3a5a3a;
            --term-text: #7a9a7a;
            --term-text-bright: #b8d0b0;
            --term-accent-rgb: 24,255,98;
            --term-code-bg: #060810;
            --term-code-text: #6a8a6a;
            --term-scroll-thumb: #1a3a1a;

            /* ── Legacy aliases (for components not yet migrated) ── */
            --px-bg-deep: var(--office-bg);
            --px-bg-panel: var(--office-panel);
            --px-bg-card: #231e38;
            --px-bg-chat: var(--term-surface);
            --px-border: var(--office-border);
            --px-border-warm: #5a3d14;
            --px-gold: #e8b040;
            --px-gold-dim: #a87820;
            --px-text: #eddcb8;
            --px-text-muted: #9a8a68;
            --px-text-dim: #6a5a48;
            --px-amber: #e0900a;
            --px-amber-bg: rgba(232, 176, 64, 0.14);
          }
          * {
            scrollbar-width: thin;
            scrollbar-color: var(--term-border) var(--term-surface);
          }
          *::-webkit-scrollbar {
            width: 3px;
            height: 3px;
          }
          *::-webkit-scrollbar-track {
            background: transparent;
          }
          *::-webkit-scrollbar-thumb {
            background: var(--term-scroll-thumb);
            border-radius: 2px;
          }
          *::-webkit-scrollbar-thumb:hover {
            background: rgba(var(--term-accent-rgb), 0.25);
          }
          *::-webkit-scrollbar-corner {
            background: transparent;
          }
          .px-font {
            font-family: 'Press Start 2P', monospace;
          }
          /* ── CRT Terminal Effects ── */
          @keyframes crt-scanline {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100vh); }
          }
          @keyframes crt-flicker {
            0% { opacity: 0.98; }
            5% { opacity: 0.96; }
            10% { opacity: 0.98; }
            15% { opacity: 0.97; }
            20% { opacity: 0.99; }
            50% { opacity: 0.96; }
            80% { opacity: 0.98; }
            100% { opacity: 0.97; }
          }
          @keyframes cursor-blink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
          @keyframes msg-fadein {
            from { opacity: 0; transform: translateY(6px) translateX(-4px); }
            to { opacity: 1; transform: translateY(0) translateX(0); }
          }
          .crt-screen {
            position: relative;
            animation: crt-flicker 4s linear infinite;
          }
          .crt-screen::after {
            content: '';
            position: absolute;
            inset: 0;
            background: repeating-linear-gradient(
              to bottom,
              transparent 0px,
              transparent 3px,
              rgba(var(--term-accent-rgb),0.04) 3px,
              rgba(var(--term-accent-rgb),0.04) 4px
            );
            pointer-events: none;
            z-index: 1;
          }
          .crt-scanline-bar {
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 80px;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(var(--term-accent-rgb),0.05) 50%,
              transparent 100%
            );
            animation: crt-scanline 6s linear infinite;
            pointer-events: none;
            z-index: 2;
          }
          .term-msg {
            animation: msg-fadein 0.15s ease-out;
          }
          .term-cursor {
            display: inline-block;
            animation: cursor-blink 1s step-end infinite;
            color: var(--term-green);
          }
          .chat-markdown, .chat-markdown *,
          .term-msg, .term-msg *,
          .crt-screen a, .crt-screen code, .crt-screen span {
            font-size: 12px !important; font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace !important;
            font-weight: 300 !important; line-height: 1.5 !important;
          }
          .chat-markdown h1, .chat-markdown h2, .chat-markdown h3,
          .chat-markdown h4, .chat-markdown h5, .chat-markdown h6 {
            margin: 0 !important; padding: 0 !important; color: inherit !important;
          }
          .chat-markdown strong, .chat-markdown b {
            font-weight: 400 !important; color: inherit !important;
          }
          .chat-markdown em, .chat-markdown i {
            font-style: normal !important; color: inherit !important;
          }
          .chat-markdown code {
            font-size: inherit !important; font-family: inherit !important;
            background: none !important; padding: 0 !important; border: none !important;
            color: var(--term-green) !important; opacity: 0.5 !important;
          }
          .chat-markdown pre {
            margin: 2px 0 !important; padding: 4px 8px !important;
            background: var(--term-code-bg) !important; border-left: 1px solid rgba(var(--term-accent-rgb),0.08) !important; overflow-x: auto;
          }
          .chat-markdown pre code {
            color: var(--term-code-text) !important; opacity: 1 !important;
          }
          .chat-markdown p { margin: 0 0 2px !important; }
          .chat-markdown ul, .chat-markdown ol { margin: 2px 0 !important; padding-left: 16px !important; }
          .chat-markdown li { margin: 0 !important; }
          .chat-markdown hr { border: none !important; border-top: 1px solid var(--term-border) !important; margin: 4px 0 !important; }
          .chat-markdown a, .crt-screen a { color: var(--term-text) !important; text-decoration: none !important; }
          .chat-markdown a:hover, .crt-screen a:hover { text-decoration: underline !important; }
          @keyframes dot-pulse {
            0% { content: '.'; }
            33% { content: '..'; }
            66% { content: '...'; }
            100% { content: '.'; }
          }
          .working-dots::after {
            content: '';
            animation: dot-pulse 1.5s steps(1) infinite;
          }
          @keyframes px-blink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
          @keyframes px-pulse-gold {
            0%, 100% { box-shadow: 0 0 0 0 rgba(200,155,48,0); }
            50% { box-shadow: 0 0 8px 2px rgba(200,155,48,0.25); }
          }
          /* ── Dot-grid background ── */
          .term-dotgrid {
            background-image: radial-gradient(circle, rgba(var(--term-accent-rgb),0.12) 1px, transparent 1px);
            background-size: 20px 20px;
          }
          /* ── Text rendering ── */
          .crt-screen, .crt-screen * {
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            font-feature-settings: "liga" 1, "calt" 1;
          }
          /* ── Text selection ── */
          .crt-screen ::selection { background: rgba(var(--term-accent-rgb),0.2); color: var(--term-text-bright); }
          /* ── Input focus glow ── */
          @keyframes input-glow {
            0%,100% { box-shadow: 0 0 4px rgba(var(--term-accent-rgb),0.1); }
            50% { box-shadow: 0 0 10px rgba(var(--term-accent-rgb),0.25); }
          }
          .term-input:focus { animation: input-glow 2s ease-in-out infinite; outline: none; }
          /* ── Button click feedback ── */
          .term-btn { transition: all 0.15s ease; }
          .term-btn:active { transform: scale(0.97); }
          /* ── Horizontal scroll for paths ── */
          .term-path-scroll { overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
          .term-path-scroll::-webkit-scrollbar { display: none; }
          /* ── Chat area vignette ── */
          .term-chat-area {
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 40px, transparent 100%);
          }
        `}} />
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator && location.hostname === 'localhost') {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  for (var r of regs) r.unregister();
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
