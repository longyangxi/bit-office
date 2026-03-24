"use client";

import { useEffect, useRef } from "react";
import { sendCommand } from "@/lib/connection";
import { computePreviewUrl, hasWebPreview, buildPreviewCommand } from "./office-utils";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

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
      className="fixed inset-0 z-[10000] pointer-events-none"
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
    <TermModal
      open={true}
      onClose={onDismiss}
      maxWidth={420}
      zIndex={9999}
      footer={
        <>
          {canPreview && (
            <TermButton
              variant="success"
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                const url = computePreviewUrl(resultInfo);
                if (url) onPreview(url);
              }}
              style={{ padding: "9px 20px" }}
            >{"\u25B6"} Preview</TermButton>
          )}
          {canLaunch && (
            <TermButton
              onClick={() => {
                const cmd = buildPreviewCommand({ previewPath, previewCmd, previewPort, projectDir, entryFile });
                if (cmd) sendCommand(cmd);
                onDismiss();
              }}
              style={{ padding: "9px 20px", borderColor: "var(--term-sem-blue)", color: "var(--term-sem-blue)" }}
            >{"\u25B6"} Launch</TermButton>
          )}
          <TermButton variant="dim" onClick={onDismiss} style={{ padding: "9px 20px" }}>OK</TermButton>
        </>
      }
    >
      <div className="text-center">
        <div className="text-[34px] mb-2.5 text-accent">{"\u2605"}</div>
        <div className="px-font text-accent text-sm mb-2.5 tracking-wide">
          Mission Complete!
        </div>
        <div className="text-muted-foreground text-sm leading-[1.7] font-mono">
          Your task has been completed successfully. Ready for the next mission whenever you are.
        </div>
      </div>
    </TermModal>
  );
}

export { ConfettiOverlay };
export default CelebrationModal;
