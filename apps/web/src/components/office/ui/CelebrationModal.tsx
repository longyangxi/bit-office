"use client";

import { useEffect, useRef } from "react";
import { sendCommand } from "@/lib/connection";
import { TERM_BG, TERM_GREEN, TERM_PANEL, TERM_BORDER, TERM_DIM, TERM_SEM_GREEN, TERM_SEM_BLUE, TERM_SEM_YELLOW } from "./termTheme";
import { computePreviewUrl, hasWebPreview, buildPreviewCommand } from "./office-utils";

function ConfettiOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd", "#01a3a4", "#ff5e57", "#0abde3", "#10ac84"];
    interface Paper { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; rotSpeed: number; color: string; alpha: number }
    const papers: Paper[] = [];
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < 120; i++) {
      papers.push({
        x: Math.random() * W,
        y: -Math.random() * H * 0.8,
        vx: (Math.random() - 0.5) * 2,
        vy: 1.5 + Math.random() * 3,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
      });
    }
    const start = performance.now();
    const DURATION = 3000;
    let raf: number;
    const animate = (now: number) => {
      const elapsed = now - start;
      const fadeAlpha = elapsed > DURATION - 800 ? Math.max(0, 1 - (elapsed - (DURATION - 800)) / 800) : 1;
      ctx.clearRect(0, 0, W, H);
      for (const p of papers) {
        p.x += p.vx + Math.sin(now * 0.002 + p.rot) * 0.5;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        // Wrap horizontally, reset if fallen below
        if (p.x < -20) p.x = W + 20;
        if (p.x > W + 20) p.x = -20;
        if (p.y > H + 20) { p.y = -10; p.x = Math.random() * W; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < DURATION) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}
    />
  );
}

function CelebrationModal({ previewUrl, previewPath, onPreview, onDismiss, previewCmd, previewPort, projectDir, entryFile }: {
  previewUrl?: string;
  previewPath?: string;
  previewCmd?: string;
  previewPort?: number;
  projectDir?: string;
  entryFile?: string;
  onPreview: (url: string) => void;
  onDismiss: () => void;
}) {
  const resultInfo = { previewUrl, previewCmd, previewPort, previewPath, entryFile };
  const canPreview = hasWebPreview(resultInfo);
  const canLaunch = !canPreview && buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        backgroundColor: TERM_BG, padding: "28px 24px",
        maxWidth: 420, width: "90%", textAlign: "center",
        border: `2px solid ${TERM_SEM_YELLOW}`, boxShadow: `0 0 40px ${TERM_SEM_YELLOW}15, 4px 4px 0px rgba(0,0,0,0.5)`,
      }}>
        <div style={{ fontSize: 34, marginBottom: 10, color: TERM_SEM_YELLOW }}>{"\u2605"}</div>
        <div className="px-font" style={{ color: TERM_SEM_YELLOW, fontSize: 14, marginBottom: 10, letterSpacing: "0.05em" }}>
          Mission Complete!
        </div>
        <div style={{
          color: TERM_DIM, fontSize: 14, marginBottom: 20, lineHeight: 1.7, fontFamily: "monospace",
        }}>
          Your task has been completed successfully. Ready for the next mission whenever you are.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {canPreview && (
            <button
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                const url = computePreviewUrl(resultInfo);
                if (url) onPreview(url);
              }}
              style={{
                padding: "9px 20px", border: `1px solid ${TERM_SEM_GREEN}`,
                backgroundColor: TERM_PANEL, color: TERM_SEM_GREEN,
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              }}
            >
              {"\u25B6"} Preview
            </button>
          )}
          {canLaunch && (
            <button
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                onDismiss();
              }}
              style={{
                padding: "9px 20px", border: `1px solid ${TERM_SEM_BLUE}`,
                backgroundColor: TERM_PANEL, color: TERM_SEM_BLUE,
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
              }}
            >
              {"\u25B6"} Launch
            </button>
          )}
          <button
            onClick={onDismiss}
            style={{
              padding: "9px 20px",
              border: `1px solid ${TERM_BORDER}`, backgroundColor: TERM_PANEL,
              color: TERM_DIM, fontSize: 13, cursor: "pointer", fontFamily: "monospace",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export { ConfettiOverlay };
export default CelebrationModal;
