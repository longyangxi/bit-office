"use client";

import { useEffect, useRef } from "react";
import { getCharacterThumbnail } from "@/components/office/sprites/spriteData";

function SpriteAvatar({ palette, zoom = 3, ready }: { palette: number; zoom?: number; ready?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sprite = getCharacterThumbnail(palette);
    if (!sprite) return;
    const h = sprite.length;
    const w = sprite[0]?.length ?? 0;
    canvas.width = w * zoom;
    canvas.height = h * zoom;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const color = sprite[r][c];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
        }
      }
    }
  }, [palette, zoom, ready]);

  return <canvas ref={canvasRef} style={{ width: 16 * zoom, height: 32 * zoom, imageRendering: "pixelated" }} />;
}

export default SpriteAvatar;
