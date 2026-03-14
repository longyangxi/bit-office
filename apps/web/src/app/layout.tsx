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
      <body style={{ margin: 0, backgroundColor: "#1a1530", color: "#eddcb8", fontFamily: "system-ui, sans-serif" }}>
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --px-bg-deep: #16122a;
            --px-bg-panel: #1e1a30;
            --px-bg-card: #231e38;
            --px-bg-chat: #1a1530;
            --px-border: #3d2e54;
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
            scrollbar-color: #5a3d14 #1a1530;
          }
          *::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          *::-webkit-scrollbar-track {
            background: transparent;
          }
          *::-webkit-scrollbar-thumb {
            background: #3d2d10;
            border-radius: 0;
          }
          *::-webkit-scrollbar-thumb:hover {
            background: #e8b040;
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
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
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
              transparent 1px,
              rgba(0,0,0,0.15) 1px,
              rgba(0,0,0,0.15) 2px
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
              rgba(24,255,98,0.03) 50%,
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
            color: #18ff62;
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
            color: #18ff62 !important; opacity: 0.5 !important;
          }
          .chat-markdown pre {
            margin: 2px 0 !important; padding: 4px 8px !important;
            background: #060810 !important; border-left: 1px solid #18ff6215 !important; overflow-x: auto;
          }
          .chat-markdown pre code {
            color: #6a8a6a !important; opacity: 1 !important;
          }
          .chat-markdown p { margin: 0 0 2px !important; }
          .chat-markdown ul, .chat-markdown ol { margin: 2px 0 !important; padding-left: 16px !important; }
          .chat-markdown li { margin: 0 !important; }
          .chat-markdown a, .crt-screen a { color: #7a9a7a !important; text-decoration: none !important; }
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
