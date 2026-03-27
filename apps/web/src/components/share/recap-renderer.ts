/**
 * recap-renderer.ts — Canvas-based frame renderer for Project Recap GIF.
 *
 * Renders 6 "slides" with micro-animations into an array of ImageData frames.
 * Each slide is rendered across multiple canvas frames to create animation:
 *   - Typewriter text reveal
 *   - Number counter roll-up
 *   - Stamp effect for PASS/FAIL verdict
 *   - Particle burst for final stats
 *
 * Output: 800×420 frames at ~10fps, totalling ~60-80 frames (6-8 second loop).
 */

import type { RecapData } from "./recap-data";

// ---- Constants ----
export const FRAME_W = 800;
export const FRAME_H = 420;
const FPS = 10;
const BG_COLOR = "#0d1117";        // GitHub dark
const ACCENT = "#58a6ff";          // Blue accent
const GREEN = "#3fb950";
const RED = "#f85149";
const ORANGE = "#d29922";
const DIM = "#8b949e";
const TEXT = "#e6edf3";
const BRAND = "#c9d1d9";

// Frames per slide
const SLIDE_FRAMES = {
  title: 12,      // 1.2s
  team: 10,       // 1.0s
  code: 12,       // 1.2s
  review: 10,     // 1.0s
  stats: 12,      // 1.2s
  branding: 8,    // 0.8s
} as const;

// ---- Public API ----

export interface RenderedFrame {
  imageData: ImageData;
  delayMs: number;  // per-frame delay for GIF
}

/**
 * Render all recap frames. Returns an array of ImageData + delay pairs.
 * Runs synchronously on an OffscreenCanvas (or regular Canvas fallback).
 */
export function renderRecapFrames(data: RecapData): RenderedFrame[] {
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(FRAME_W, FRAME_H)
    : document.createElement("canvas");
  if ("width" in canvas) {
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
  }
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  if (!ctx) throw new Error("Failed to get 2d context");

  const frames: RenderedFrame[] = [];
  const push = (delayMs = 100) => {
    frames.push({
      imageData: ctx.getImageData(0, 0, FRAME_W, FRAME_H),
      delayMs,
    });
  };

  // Slide 1: Title + project name
  for (let i = 0; i < SLIDE_FRAMES.title; i++) {
    const t = i / (SLIDE_FRAMES.title - 1); // 0→1
    drawBackground(ctx);
    drawTopBar(ctx);
    drawBottomBar(ctx);

    // Typewriter: project name
    const name = data.projectName;
    const visLen = Math.ceil(name.length * t);
    const visName = name.slice(0, visLen);

    ctx.font = "bold 36px 'SF Mono', 'Fira Code', 'Cascadia Code', monospace";
    ctx.fillStyle = TEXT;
    ctx.textAlign = "center";
    ctx.fillText(visName, FRAME_W / 2, 180);

    // Cursor blink
    if (t < 1) {
      const textW = ctx.measureText(visName).width;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(FRAME_W / 2 + textW / 2 + 2, 158, 3, 28);
    }

    // Subtitle fade in
    if (t > 0.5) {
      const subAlpha = (t - 0.5) * 2;
      ctx.globalAlpha = subAlpha;
      ctx.font = "16px 'SF Mono', monospace";
      ctx.fillStyle = DIM;
      ctx.fillText("AI Team Project Recap", FRAME_W / 2, 220);
      ctx.globalAlpha = 1;
    }

    // Last frame: hold longer
    push(i === SLIDE_FRAMES.title - 1 ? 600 : 100);
  }

  // Slide 2: Team roster
  for (let i = 0; i < SLIDE_FRAMES.team; i++) {
    const t = i / (SLIDE_FRAMES.team - 1);
    drawBackground(ctx);
    drawTopBar(ctx);
    drawBottomBar(ctx);

    ctx.font = "bold 14px 'SF Mono', monospace";
    ctx.fillStyle = DIM;
    ctx.textAlign = "center";
    ctx.fillText("TEAM", FRAME_W / 2, 100);

    const agents = data.agents;
    const totalW = agents.length * 160;
    const startX = (FRAME_W - totalW) / 2 + 80;

    agents.forEach((agent, idx) => {
      const agentT = clamp((t * agents.length - idx * 0.3) / 0.7, 0, 1);
      if (agentT <= 0) return;

      const x = startX + idx * 160;
      const y = 190;

      ctx.globalAlpha = agentT;

      // Avatar circle
      const colors = ["#f78166", "#d2a8ff", "#7ee787", "#79c0ff", "#ffa657", "#ff7b72", "#d29922", "#58a6ff"];
      const color = colors[agent.palette ?? idx % colors.length];
      ctx.beginPath();
      ctx.arc(x, y - 30, 24, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Agent initial in circle
      ctx.font = "bold 20px 'SF Mono', monospace";
      ctx.fillStyle = BG_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(agent.name[0].toUpperCase(), x, y - 30);
      ctx.textBaseline = "alphabetic";

      // Name
      ctx.font = "bold 16px 'SF Mono', monospace";
      ctx.fillStyle = TEXT;
      ctx.fillText(agent.name, x, y + 10);

      // Role badge
      const roleEmoji = agent.role === "reviewer" ? "Review" : agent.role === "leader" ? "Lead" : "Dev";
      ctx.font = "12px 'SF Mono', monospace";
      ctx.fillStyle = DIM;
      ctx.fillText(roleEmoji, x, y + 30);

      ctx.globalAlpha = 1;
    });

    push(i === SLIDE_FRAMES.team - 1 ? 500 : 100);
  }

  // Slide 3: Code stats (counter roll-up)
  for (let i = 0; i < SLIDE_FRAMES.code; i++) {
    const t = easeOutCubic(i / (SLIDE_FRAMES.code - 1));
    drawBackground(ctx);
    drawTopBar(ctx);
    drawBottomBar(ctx);

    ctx.font = "bold 14px 'SF Mono', monospace";
    ctx.fillStyle = DIM;
    ctx.textAlign = "center";
    ctx.fillText("CODE CHANGES", FRAME_W / 2, 100);

    // Files changed
    const files = Math.round(data.filesChanged * t);
    ctx.font = "bold 48px 'SF Mono', monospace";
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${files}`, FRAME_W / 2, 175);
    ctx.font = "14px 'SF Mono', monospace";
    ctx.fillStyle = DIM;
    ctx.fillText("files changed", FRAME_W / 2, 200);

    // Lines added / removed
    const added = Math.round(data.linesAdded * t);
    const removed = Math.round(data.linesRemoved * t);

    ctx.font = "bold 28px 'SF Mono', monospace";
    ctx.fillStyle = GREEN;
    ctx.textAlign = "right";
    ctx.fillText(`+${added}`, FRAME_W / 2 - 30, 265);

    ctx.fillStyle = RED;
    ctx.textAlign = "left";
    ctx.fillText(`-${removed}`, FRAME_W / 2 + 30, 265);

    // Progress bar
    const total = data.linesAdded + data.linesRemoved || 1;
    const addRatio = data.linesAdded / total;
    const barY = 290;
    const barW = 400;
    const barH = 8;
    const barX = (FRAME_W - barW) / 2;
    const barProgress = t;

    ctx.fillStyle = "#21262d";
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fill();

    // Green portion
    const greenW = barW * addRatio * barProgress;
    if (greenW > 0) {
      ctx.fillStyle = GREEN;
      roundRect(ctx, barX, barY, greenW, barH, 4);
      ctx.fill();
    }
    // Red portion
    const redW = barW * (1 - addRatio) * barProgress;
    if (redW > 0) {
      ctx.fillStyle = RED;
      roundRect(ctx, barX + barW - redW, barY, redW, barH, 4);
      ctx.fill();
    }

    push(i === SLIDE_FRAMES.code - 1 ? 500 : 100);
  }

  // Slide 4: Review (stamp effect)
  for (let i = 0; i < SLIDE_FRAMES.review; i++) {
    const t = i / (SLIDE_FRAMES.review - 1);
    drawBackground(ctx);
    drawTopBar(ctx);
    drawBottomBar(ctx);

    if (data.reviewRounds.length === 0) {
      // No reviews — show solo mode
      ctx.font = "bold 14px 'SF Mono', monospace";
      ctx.fillStyle = DIM;
      ctx.textAlign = "center";
      ctx.fillText("SOLO MODE", FRAME_W / 2, 100);

      ctx.font = "24px 'SF Mono', monospace";
      ctx.fillStyle = TEXT;
      ctx.fillText("No review — direct delivery", FRAME_W / 2, 200);
    } else {
      ctx.font = "bold 14px 'SF Mono', monospace";
      ctx.fillStyle = DIM;
      ctx.textAlign = "center";
      ctx.fillText("CODE REVIEW", FRAME_W / 2, 100);

      // Review rounds list
      const startY = 140;
      data.reviewRounds.forEach((r, idx) => {
        const roundT = clamp((t * data.reviewRounds.length - idx * 0.4) / 0.6, 0, 1);
        if (roundT <= 0) return;

        ctx.globalAlpha = roundT;
        const y = startY + idx * 50;

        ctx.font = "14px 'SF Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = DIM;
        ctx.fillText(`Round ${r.round}`, 180, y);

        // Verdict badge
        const vColor = r.verdict === "pass" ? GREEN : r.verdict === "fail" ? RED : ORANGE;
        ctx.fillStyle = vColor;
        ctx.font = "bold 14px 'SF Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(r.verdict.toUpperCase(), 620, y);

        ctx.globalAlpha = 1;
      });

      // Final stamp (appears on last frames)
      if (t > 0.6 && data.finalVerdict !== "unknown") {
        const stampT = (t - 0.6) / 0.4;
        const scale = 1 + (1 - stampT) * 2; // Starts big, shrinks to 1x
        const stampColor = data.finalVerdict === "pass" ? GREEN : RED;
        const stampText = data.finalVerdict === "pass" ? "PASS" : "FAIL";

        ctx.save();
        ctx.translate(FRAME_W / 2, 300);
        ctx.scale(scale, scale);
        ctx.globalAlpha = stampT;
        ctx.font = "bold 48px 'SF Mono', monospace";
        ctx.fillStyle = stampColor;
        ctx.textAlign = "center";
        ctx.fillText(stampText, 0, 0);

        // Stamp border
        ctx.strokeStyle = stampColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(-80, -40, 160, 56);

        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    push(i === SLIDE_FRAMES.review - 1 ? 500 : 100);
  }

  // Slide 5: Final stats (particles + counters)
  for (let i = 0; i < SLIDE_FRAMES.stats; i++) {
    const t = easeOutCubic(i / (SLIDE_FRAMES.stats - 1));
    drawBackground(ctx);
    drawTopBar(ctx);
    drawBottomBar(ctx);

    // Particle burst (decorative dots)
    if (t > 0.3) {
      const particleT = (t - 0.3) / 0.7;
      const particleColors = [ACCENT, GREEN, "#d2a8ff", "#ffa657", "#ff7b72"];
      for (let p = 0; p < 30; p++) {
        const seed = p * 137.508; // golden angle
        const angle = (seed % 360) * Math.PI / 180;
        const dist = 40 + (seed % 160) * particleT;
        const px = FRAME_W / 2 + Math.cos(angle) * dist;
        const py = 200 + Math.sin(angle) * dist;
        const size = 2 + (seed % 3);
        const alpha = Math.max(0, 1 - particleT * 1.5 + (seed % 0.5));

        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = particleColors[p % particleColors.length];
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Duration
    const durMin = Math.floor(data.durationSec / 60);
    const durSec = data.durationSec % 60;
    const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;

    const tokenK = Math.round((data.totalTokens * t) / 1000);

    // Three stat boxes
    const statY = 160;
    const stats = [
      { label: "DURATION", value: durStr, color: ACCENT },
      { label: "TOKENS", value: `${tokenK}K`, color: "#d2a8ff" },
      { label: "TEST", value: data.testResult === "passed" ? "PASS" : data.testResult === "failed" ? "FAIL" : "N/A", color: data.testResult === "passed" ? GREEN : data.testResult === "failed" ? RED : DIM },
    ];

    stats.forEach((s, idx) => {
      const x = 160 + idx * 240;

      ctx.font = "bold 12px 'SF Mono', monospace";
      ctx.fillStyle = DIM;
      ctx.textAlign = "center";
      ctx.fillText(s.label, x, statY - 20);

      ctx.font = "bold 32px 'SF Mono', monospace";
      ctx.fillStyle = s.color;
      ctx.fillText(s.value, x, statY + 20);
    });

    // Tagline
    if (t > 0.5) {
      ctx.globalAlpha = (t - 0.5) * 2;
      ctx.font = "18px 'SF Mono', monospace";
      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";
      ctx.fillText("Built by AI, managed by you", FRAME_W / 2, 280);
      ctx.globalAlpha = 1;
    }

    push(i === SLIDE_FRAMES.stats - 1 ? 600 : 100);
  }

  // Slide 6: Branding / loop point
  for (let i = 0; i < SLIDE_FRAMES.branding; i++) {
    const t = i / (SLIDE_FRAMES.branding - 1);
    drawBackground(ctx);

    // Centered logo text with glow
    ctx.save();
    ctx.font = "bold 28px 'SF Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 20 * t;
    ctx.fillText("OPEN OFFICE", FRAME_W / 2, 195);
    ctx.restore();

    ctx.font = "14px 'SF Mono', monospace";
    ctx.fillStyle = DIM;
    ctx.textAlign = "center";
    ctx.fillText("Your AI team, working visibly", FRAME_W / 2, 230);

    push(i === SLIDE_FRAMES.branding - 1 ? 800 : 100);
  }

  return frames;
}

// ---- Drawing helpers ----

function drawBackground(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  // Subtle grid pattern
  ctx.strokeStyle = "#161b22";
  ctx.lineWidth = 1;
  for (let x = 0; x < FRAME_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, FRAME_H);
    ctx.stroke();
  }
  for (let y = 0; y < FRAME_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(FRAME_W, y);
    ctx.stroke();
  }
}

function drawTopBar(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = "#161b22";
  ctx.fillRect(0, 0, FRAME_W, 44);

  // "Open Office" brand
  ctx.font = "bold 14px 'SF Mono', monospace";
  ctx.fillStyle = BRAND;
  ctx.textAlign = "left";
  ctx.fillText("OPEN OFFICE", 20, 28);

  // Decorative dots (macOS traffic lights style)
  const dotColors = ["#f85149", "#d29922", "#3fb950"];
  dotColors.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(FRAME_W - 80 + i * 20, 22, 5, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
}

function drawBottomBar(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = "#161b22";
  ctx.fillRect(0, FRAME_H - 32, FRAME_W, 32);

  ctx.font = "11px 'SF Mono', monospace";
  ctx.fillStyle = DIM;
  ctx.textAlign = "center";
  ctx.fillText("open-office.dev", FRAME_W / 2, FRAME_H - 12);
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
