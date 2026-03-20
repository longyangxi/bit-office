import type { Metadata } from "next";
import "@/styles/global.css";

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
        <link
          id="google-fonts"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&family=Press+Start+2P&display=swap"
          rel="stylesheet"
          media="print"
        />
        <script dangerouslySetInnerHTML={{ __html: `
          document.getElementById('google-fonts').onload = function() { this.media = 'all'; };
        `}} />
        <noscript>
          <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&family=Press+Start+2P&display=swap" rel="stylesheet" />
        </noscript>
      </head>
      <body style={{ margin: 0, backgroundColor: "#16122a", color: "#eddcb8", fontFamily: "system-ui, sans-serif" }}>
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
                  // Observe subtree content changes (e.g. streaming chat messages)
                  var contentTimer = 0;
                  new MutationObserver(function() {
                    if (contentTimer) return;
                    contentTimer = setTimeout(function() { contentTimer = 0; update(); }, 150);
                  }).observe(el, { childList: true, subtree: true, characterData: true });
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
