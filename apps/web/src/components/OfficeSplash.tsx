"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Pixel font rendering (5x7 bitmap font) ─────────────────────────
const PIXEL_CHARS: Record<string, number[]> = {
  A: [0x1c,0x22,0x22,0x3e,0x22,0x22,0x22],
  B: [0x3c,0x22,0x22,0x3c,0x22,0x22,0x3c],
  C: [0x1c,0x22,0x20,0x20,0x20,0x22,0x1c],
  D: [0x3c,0x22,0x22,0x22,0x22,0x22,0x3c],
  E: [0x3e,0x20,0x20,0x3c,0x20,0x20,0x3e],
  F: [0x3e,0x20,0x20,0x3c,0x20,0x20,0x20],
  G: [0x1c,0x22,0x20,0x2e,0x22,0x22,0x1c],
  H: [0x22,0x22,0x22,0x3e,0x22,0x22,0x22],
  I: [0x1c,0x08,0x08,0x08,0x08,0x08,0x1c],
  J: [0x0e,0x04,0x04,0x04,0x04,0x24,0x18],
  K: [0x22,0x24,0x28,0x30,0x28,0x24,0x22],
  L: [0x20,0x20,0x20,0x20,0x20,0x20,0x3e],
  M: [0x22,0x36,0x2a,0x2a,0x22,0x22,0x22],
  N: [0x22,0x32,0x2a,0x26,0x22,0x22,0x22],
  O: [0x1c,0x22,0x22,0x22,0x22,0x22,0x1c],
  P: [0x3c,0x22,0x22,0x3c,0x20,0x20,0x20],
  Q: [0x1c,0x22,0x22,0x22,0x2a,0x24,0x1a],
  R: [0x3c,0x22,0x22,0x3c,0x28,0x24,0x22],
  S: [0x1c,0x22,0x20,0x1c,0x02,0x22,0x1c],
  T: [0x3e,0x08,0x08,0x08,0x08,0x08,0x08],
  U: [0x22,0x22,0x22,0x22,0x22,0x22,0x1c],
  V: [0x22,0x22,0x22,0x22,0x14,0x14,0x08],
  W: [0x22,0x22,0x22,0x2a,0x2a,0x36,0x22],
  X: [0x22,0x22,0x14,0x08,0x14,0x22,0x22],
  Y: [0x22,0x22,0x14,0x08,0x08,0x08,0x08],
  Z: [0x3e,0x02,0x04,0x08,0x10,0x20,0x3e],
  " ": [0,0,0,0,0,0,0],
  "0": [0x1c,0x22,0x26,0x2a,0x32,0x22,0x1c],
  "1": [0x08,0x18,0x08,0x08,0x08,0x08,0x1c],
  "2": [0x1c,0x22,0x02,0x0c,0x10,0x20,0x3e],
  "3": [0x1c,0x22,0x02,0x0c,0x02,0x22,0x1c],
  "4": [0x04,0x0c,0x14,0x24,0x3e,0x04,0x04],
  "5": [0x3e,0x20,0x3c,0x02,0x02,0x22,0x1c],
  "6": [0x1c,0x20,0x3c,0x22,0x22,0x22,0x1c],
  "7": [0x3e,0x02,0x04,0x08,0x10,0x10,0x10],
  "8": [0x1c,0x22,0x22,0x1c,0x22,0x22,0x1c],
  "9": [0x1c,0x22,0x22,0x1e,0x02,0x02,0x1c],
  ".": [0,0,0,0,0,0x08,0x08],
  "!": [0x08,0x08,0x08,0x08,0x08,0,0x08],
  "-": [0,0,0,0x1c,0,0,0],
  ">": [0x10,0x08,0x04,0x02,0x04,0x08,0x10],
};

// ── Matrix rain column ──────────────────────────────────────────────
interface RainDrop {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  opacity: number;
}

// ── Boot sequence lines ─────────────────────────────────────────────
const BOOT_LINES = [
  { text: "> SYSTEM INIT...", color: "#22c55e", delay: 0 },
  { text: "> LOADING NEURAL CORE", color: "#22c55e", delay: 600 },
  { text: "> OPEN OFFICE ENGINE V1.0", color: "#818cf8", delay: 1200 },
  { text: "> MULTI-AGENT SOFTWARE DELIVERY", color: "#a1a1aa", delay: 1600 },
  { text: "> OFFICE MODE READY", color: "#f97316", delay: 2000 },
];

export default function OfficeSplash({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"boot" | "title" | "ready">("boot");
  const [bootLine, setBootLine] = useState(0);
  const [showPress, setShowPress] = useState(false);
  const startTimeRef = useRef(Date.now());
  const rainRef = useRef<RainDrop[]>([]);
  const animRef = useRef(0);
  const glitchRef = useRef(0);

  // Initialize rain drops
  const initRain = useCallback((width: number) => {
    const cols = Math.floor(width / 14);
    const katakana = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
    rainRef.current = Array.from({ length: cols }, (_, i) => ({
      x: i * 14,
      y: Math.random() * -500,
      speed: 1 + Math.random() * 3,
      chars: Array.from({ length: 20 }, () => katakana[Math.floor(Math.random() * katakana.length)]),
      opacity: 0.3 + Math.random() * 0.7,
    }));
  }, []);

  // Draw pixel text
  const drawPixelText = useCallback((ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) => {
    ctx.fillStyle = color;
    const charWidth = 6 * scale;
    const startX = x - (text.length * charWidth) / 2;
    for (let c = 0; c < text.length; c++) {
      const ch = text[c].toUpperCase();
      const bitmap = PIXEL_CHARS[ch];
      if (!bitmap) continue;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 6; col++) {
          if (bitmap[row] & (1 << (5 - col))) {
            ctx.fillRect(
              startX + c * charWidth + col * scale,
              y + row * scale,
              scale,
              scale
            );
          }
        }
      }
    }
  }, []);

  // Boot sequence timing
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    BOOT_LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setBootLine(i + 1), line.delay));
    });
    timers.push(setTimeout(() => setPhase("title"), 3200));
    timers.push(setTimeout(() => {
      setPhase("ready");
      setShowPress(true);
    }, 4600));
    return () => timers.forEach(clearTimeout);
  }, []);

  // Blinking "PRESS START"
  useEffect(() => {
    if (!showPress) return;
    const id = setInterval(() => setShowPress(v => !v), 500);
    return () => clearInterval(id);
  }, [showPress]);

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initRain(canvas.width);
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      const { width, height } = canvas;
      const elapsed = Date.now() - startTimeRef.current;

      // Clear with slight trail
      ctx.fillStyle = "rgba(10, 10, 20, 0.15)";
      ctx.fillRect(0, 0, width, height);

      // ── Matrix rain ───────────────────────────────────
      rainRef.current.forEach(drop => {
        drop.y += drop.speed;
        if (drop.y > height + 300) {
          drop.y = Math.random() * -300;
        }
        drop.chars.forEach((ch, i) => {
          const cy = drop.y + i * 16;
          if (cy < 0 || cy > height) return;
          const isHead = i === 0;
          ctx.font = "14px monospace";
          ctx.fillStyle = isHead
            ? `rgba(180, 255, 180, ${drop.opacity})`
            : `rgba(0, 180, 80, ${drop.opacity * (1 - i / drop.chars.length)})`;
          ctx.fillText(ch, drop.x, cy);
        });
      });

      // ── Scanlines ─────────────────────────────────────
      for (let y = 0; y < height; y += 3) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
        ctx.fillRect(0, y, width, 1);
      }

      // ── Glitch effect ─────────────────────────────────
      if (Math.random() < 0.02) {
        glitchRef.current = 8;
      }
      if (glitchRef.current > 0) {
        const sliceH = 4 + Math.random() * 20;
        const sliceY = Math.random() * height;
        const shift = (Math.random() - 0.5) * 40;
        const imgData = ctx.getImageData(0, sliceY, width, sliceH);
        ctx.putImageData(imgData, shift, sliceY);
        glitchRef.current--;
      }

      // ── Boot text ─────────────────────────────────────
      if (elapsed < 3400) {
        ctx.font = "16px monospace";
        for (let i = 0; i < bootLine; i++) {
          const line = BOOT_LINES[i];
          ctx.fillStyle = line.color;
          const lineElapsed = elapsed - line.delay;
          const visibleChars = Math.min(line.text.length, Math.floor(lineElapsed / 30));
          ctx.fillText(line.text.slice(0, visibleChars), 40, height / 2 - 60 + i * 28);
          // Cursor blink
          if (i === bootLine - 1 && visibleChars < line.text.length) {
            if (Math.floor(elapsed / 200) % 2 === 0) {
              const cursorX = 40 + ctx.measureText(line.text.slice(0, visibleChars)).width;
              ctx.fillRect(cursorX + 2, height / 2 - 74 + i * 28, 10, 18);
            }
          }
        }
      }

      // ── Title sequence ────────────────────────────────
      if (elapsed > 3200) {
        const titleAlpha = Math.min(1, (elapsed - 3200) / 800);

        // Glow behind title
        const grd = ctx.createRadialGradient(width / 2, height / 2 - 30, 0, width / 2, height / 2 - 30, 200);
        grd.addColorStop(0, `rgba(79, 70, 229, ${0.3 * titleAlpha})`);
        grd.addColorStop(1, "rgba(79, 70, 229, 0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, width, height);

        // Big pixel title
        const pixelScale = Math.min(4, width / 120);
        const titleColor = `rgba(255, 255, 255, ${titleAlpha})`;
        drawPixelText(ctx, "OPEN", width / 2, height / 2 - 40, pixelScale, titleColor);
        drawPixelText(ctx, "OFFICE", width / 2, height / 2 + 10, pixelScale, `rgba(249, 115, 22, ${titleAlpha})`);

        // Decorative line
        ctx.strokeStyle = `rgba(79, 70, 229, ${titleAlpha * 0.6})`;
        ctx.lineWidth = 2;
        const lineW = Math.min(280, width - 80);
        ctx.beginPath();
        ctx.moveTo(width / 2 - lineW / 2, height / 2 + 55);
        ctx.lineTo(width / 2 + lineW / 2, height / 2 + 55);
        ctx.stroke();

        // Subtitle
        if (elapsed > 3800) {
          const subAlpha = Math.min(1, (elapsed - 3800) / 600);
          ctx.font = "13px monospace";
          ctx.fillStyle = `rgba(170, 170, 170, ${subAlpha})`;
          ctx.textAlign = "center";
          ctx.fillText("PARALLEL AI AGENTS. ONE WORKSPACE.", width / 2, height / 2 + 76);
          ctx.textAlign = "start";
        }
      }

      // ── PRESS START ───────────────────────────────────
      if (elapsed > 4600) {
        const blink = Math.floor(elapsed / 500) % 2 === 0;
        if (blink) {
          drawPixelText(ctx, "PRESS START", width / 2, height / 2 + 110, 2, "#22c55e");
        }
      }

      // ── Vignette ──────────────────────────────────────
      const vgrd = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.8);
      vgrd.addColorStop(0, "rgba(0,0,0,0)");
      vgrd.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vgrd;
      ctx.fillRect(0, 0, width, height);

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [bootLine, initRain, drawPixelText]);

  // Click/tap/key to proceed
  useEffect(() => {
    if (phase !== "ready") return;
    const handle = () => onComplete();
    window.addEventListener("click", handle);
    window.addEventListener("keydown", handle);
    window.addEventListener("touchstart", handle);
    return () => {
      window.removeEventListener("click", handle);
      window.removeEventListener("keydown", handle);
      window.removeEventListener("touchstart", handle);
    };
  }, [phase, onComplete]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
        cursor: phase === "ready" ? "pointer" : "default",
      }}
    />
  );
}
