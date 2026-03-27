import { useRef, useEffect } from "react";

/** Matrix-style binary rain on canvas — each column spawns at random x/y */
export function MatrixRainCanvas({ color, font }: { color: string; font: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const fontSize = 14;
    const lineH = 20;
    const colCount = 6;      // max simultaneous columns
    const digitCount = 12;   // digits per column
    const speed = 60;        // px per second

    interface Drop { x: number; y: number; digits: string[]; opacity: number; speed: number }
    const drops: Drop[] = [];

    function spawnDrop(randomY: boolean): Drop {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(cvs!.width / dpr, cvs!.clientWidth || 300);
      const h = Math.max(cvs!.height / dpr, cvs!.clientHeight || 150);
      return {
        x: Math.random() * w,
        y: randomY
          ? Math.random() * h              // anywhere in visible area
          : -(Math.random() * 0.3 + 0.1) * h, // just above visible area
        digits: Array.from({ length: digitCount }, () => Math.random() > 0.5 ? "1" : "0"),
        opacity: 0.12 + Math.random() * 0.14,
        speed: speed + Math.random() * 40,
      };
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = cvs!.getBoundingClientRect();
      cvs!.width = rect.width * dpr;
      cvs!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    // Init AFTER resize so canvas dimensions are correct
    for (let i = 0; i < colCount; i++) {
      drops.push(spawnDrop(true));
    }

    let lastT = performance.now();
    function draw(t: number) {
      const dt = (t - lastT) / 1000;
      lastT = t;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(cvs!.width / dpr, cvs!.clientWidth || 300);
      const h = Math.max(cvs!.height / dpr, cvs!.clientHeight || 150);
      ctx!.clearRect(0, 0, w, h);
      ctx!.font = `${fontSize}px ${font}`;
      ctx!.textAlign = "center";

      for (const d of drops) {
        d.y += d.speed * dt;
        ctx!.fillStyle = color;
        ctx!.globalAlpha = d.opacity;
        for (let j = 0; j < d.digits.length; j++) {
          const dy = d.y + j * lineH;
          if (dy > -lineH && dy < h + lineH) {
            ctx!.fillText(d.digits[j], d.x, dy);
          }
        }
        // Reset when fully off bottom
        if (d.y > h + lineH) {
          Object.assign(d, spawnDrop(false));
        }
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [color, font]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
