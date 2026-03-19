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

            /* ── Console/chat (terminal, office theme) ── */
            --term-bg: #141218;
            --term-panel: #1a1820;
            --term-card: #201e28;
            --term-surface: #201e28;
            --term-border: #302a38;
            --term-border-dim: #262030;
            --term-green: #d4a860;
            --term-green-dim: #685848;
            --term-text: #c8b8a8;
            --term-text-bright: #e0d4c8;
            --term-accent-rgb: 212,168,96;
            --term-code-bg: #18161e;
            --term-code-text: #a08858;
            --term-scroll-thumb: #383040;
            --term-sem-green: #48cc6a;
            --term-sem-yellow: #e8b040;
            --term-sem-red: #e04848;
            --term-sem-blue: #5aacff;
            --term-sem-purple: #c084fc;
            --term-sem-cyan: #94e2d5;

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
          /* Hide native scrollbar, use custom indicator instead */
          * {
            scrollbar-width: none;
          }
          *::-webkit-scrollbar {
            display: none;
          }
          /* Custom scrollbar indicator */
          .custom-scrollbar {
            position: absolute;
            right: 1px;
            top: 0;
            bottom: 0;
            width: 4px;
            pointer-events: none;
            z-index: 10;
            opacity: 0;
            transition: opacity 0.3s;
          }
          .custom-scrollbar.visible {
            opacity: 1;
          }
          .custom-scrollbar-thumb {
            position: absolute;
            right: 0;
            width: 4px;
            min-height: 20px;
            background: var(--term-scroll-thumb);
            border-radius: 2px;
            transition: background 0.15s;
          }
          .custom-scrollbar-thumb:hover {
            background: rgba(var(--term-accent-rgb), 0.3);
          }
          /* Custom select styling for WebView compatibility */
          select {
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239a8a68'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 8px center;
            background-size: 10px 6px;
            padding-right: 24px !important;
            border-radius: 3px;
          }
          select option {
            background: #14112a;
            color: #eddcb8;
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
            font-weight: 300 !important; line-height: 1.6 !important;
          }
          /* ── Headings ── */
          .chat-markdown h1 {
            font-size: 14px !important; font-weight: 600 !important;
            color: var(--term-green) !important; opacity: 0.9;
            margin: 12px 0 6px !important; padding: 0 !important;
            border-bottom: 1px solid rgba(var(--term-accent-rgb),0.12) !important;
            padding-bottom: 4px !important;
          }
          .chat-markdown h2 {
            font-size: 13px !important; font-weight: 600 !important;
            color: var(--term-green) !important; opacity: 0.8;
            margin: 10px 0 4px !important; padding: 0 !important;
          }
          .chat-markdown h3 {
            font-size: 12px !important; font-weight: 600 !important;
            color: var(--term-green) !important; opacity: 0.7;
            margin: 8px 0 3px !important; padding: 0 !important;
          }
          .chat-markdown h4, .chat-markdown h5, .chat-markdown h6 {
            font-size: 12px !important; font-weight: 500 !important;
            color: var(--term-text-bright) !important;
            margin: 6px 0 2px !important; padding: 0 !important;
          }
          /* ── Inline emphasis ── */
          .chat-markdown strong, .chat-markdown b {
            font-weight: 600 !important; color: var(--term-text-bright) !important;
          }
          .chat-markdown em, .chat-markdown i {
            font-style: italic !important; color: var(--term-dim) !important;
            opacity: 0.9;
          }
          /* ── Code ── */
          .chat-markdown code {
            font-size: inherit !important; font-family: inherit !important;
            background: rgba(var(--term-accent-rgb),0.06) !important;
            padding: 1px 5px !important; border-radius: 3px !important;
            border: 1px solid rgba(var(--term-accent-rgb),0.1) !important;
            color: var(--term-green) !important; opacity: 0.7 !important;
          }
          .chat-markdown pre {
            margin: 8px 0 !important; padding: 10px 12px !important;
            background: var(--term-code-bg) !important;
            border-left: 2px solid rgba(var(--term-accent-rgb),0.2) !important;
            border-radius: 0 4px 4px 0 !important;
            overflow-x: auto;
          }
          .chat-markdown pre code {
            color: var(--term-code-text) !important; opacity: 1 !important;
            background: none !important; padding: 0 !important;
            border: none !important; border-radius: 0 !important;
          }
          /* ── Block elements ── */
          .chat-markdown p { margin: 0 0 6px !important; }
          .chat-markdown p:last-child { margin-bottom: 0 !important; }
          .chat-markdown ul, .chat-markdown ol { margin: 4px 0 8px !important; padding-left: 20px !important; }
          .chat-markdown li { margin: 2px 0 !important; }
          .chat-markdown li::marker { color: var(--term-dim) !important; }
          .chat-markdown hr { border: none !important; border-top: 1px solid var(--term-border) !important; margin: 8px 0 !important; }
          .chat-markdown blockquote {
            margin: 6px 0 !important; padding: 4px 12px !important;
            border-left: 2px solid rgba(var(--term-accent-rgb),0.3) !important;
            color: var(--term-dim) !important;
          }
          /* ── Links ── */
          .chat-markdown a, .crt-screen a { color: var(--term-green) !important; opacity: 0.7; text-decoration: none !important; }
          .chat-markdown a:hover, .crt-screen a:hover { opacity: 1; text-decoration: underline !important; }
          /* ── Tables ── */
          .chat-markdown table {
            border-collapse: collapse !important; margin: 8px 0 !important; width: 100% !important;
          }
          .chat-markdown th {
            padding: 4px 12px !important; text-align: left !important;
            font-weight: 600 !important; color: var(--term-text-bright) !important;
            border-bottom: 2px solid rgba(var(--term-accent-rgb),0.2) !important;
          }
          .chat-markdown td {
            padding: 3px 12px !important;
            border-bottom: 1px solid rgba(var(--term-accent-rgb),0.06) !important;
          }
          .chat-markdown tr:hover td {
            background: rgba(var(--term-accent-rgb),0.03) !important;
          }
          @keyframes dot1 {
            0%, 24%  { opacity: 0; }
            25%, 100% { opacity: 1; }
          }
          @keyframes dot2 {
            0%, 49%  { opacity: 0; }
            50%, 100% { opacity: 1; }
          }
          @keyframes dot3 {
            0%, 74%  { opacity: 0; }
            75%, 100% { opacity: 1; }
          }
          .working-dots {
            display: inline-flex;
            gap: 2px;
            align-items: center;
            vertical-align: middle;
          }
          .working-dots::before,
          .working-dots::after {
            content: '';
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: currentColor;
          }
          .working-dots::before {
            animation: dot1 2s step-end infinite;
          }
          .working-dots::after {
            animation: dot3 2s step-end infinite;
          }
          .working-dots-mid {
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: currentColor;
            animation: dot2 2s step-end infinite;
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
          /* ── Scene loading overlay fade-out ── */
          @keyframes scene-overlay-fadeout {
            from { opacity: 1; }
            to { opacity: 0; visibility: hidden; }
          }
          @keyframes review-overlay-in {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          /* ── Chat area vignette ── */
          .term-chat-area {
            background-image: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 40px, transparent 100%);
          }
          /* ── Clean mode: disable all textures and effects ── */
          .term-clean .crt-screen { animation: none !important; }
          .term-clean .crt-screen::after { display: none !important; }
          .term-clean .crt-scanline-bar { display: none !important; }
          .term-clean .term-dotgrid { background-image: none !important; }
          .term-clean .term-chat-area { background-image: none !important; }
          .term-clean .term-input:focus { animation: none !important; box-shadow: none !important; outline: none; }
          /* ── Pause animations when page hidden (saves GPU) ── */
          .term-paused .crt-screen,
          .term-paused .crt-scanline-bar,
          .term-paused .term-cursor,
          .term-paused .working-dots,
          .term-paused .working-dots::before,
          .term-paused .working-dots::after,
          .term-paused .working-dots-mid {
            animation-play-state: paused !important;
          }
        `}} />
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('visibilitychange', function() {
                document.body.classList.toggle('term-paused', document.hidden);
              });
            `,
          }}
        />
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var attached = new WeakSet();
                var timers = new WeakMap();
                function addScrollbar(el) {
                  if (attached.has(el)) return;
                  var cs = getComputedStyle(el);
                  var ov = cs.overflowY;
                  if (ov !== 'auto' && ov !== 'scroll') return;
                  if (cs.position === 'static') el.style.position = 'relative';
                  var track = document.createElement('div');
                  track.className = 'custom-scrollbar';
                  var thumb = document.createElement('div');
                  thumb.className = 'custom-scrollbar-thumb';
                  track.appendChild(thumb);
                  el.appendChild(track);
                  attached.add(el);
                  function update() {
                    var sh = el.scrollHeight, ch = el.clientHeight;
                    if (sh <= ch) { track.classList.remove('visible'); return; }
                    var ratio = ch / sh;
                    var thumbH = Math.max(20, ratio * ch);
                    var scrollRatio = el.scrollTop / (sh - ch);
                    var thumbTop = scrollRatio * (ch - thumbH);
                    thumb.style.height = thumbH + 'px';
                    thumb.style.top = (el.scrollTop + thumbTop) + 'px';
                    track.classList.add('visible');
                    clearTimeout(timers.get(el));
                    timers.set(el, setTimeout(function() { track.classList.remove('visible'); }, 1200));
                  }
                  el.addEventListener('scroll', update, { passive: true });
                  new ResizeObserver(update).observe(el);
                  update();
                }
                function scan() {
                  document.querySelectorAll('[data-scrollbar]').forEach(function(el) {
                    addScrollbar(el);
                  });
                }
                var scanTimer = 0;
                var mo = new MutationObserver(function() {
                  if (scanTimer) return;
                  scanTimer = setTimeout(function() { scanTimer = 0; scan(); }, 300);
                });
                mo.observe(document.body, { childList: true, subtree: true });
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
                else scan();
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
