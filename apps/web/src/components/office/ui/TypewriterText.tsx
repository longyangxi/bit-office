"use client";

import { useState, useEffect, useRef } from "react";

/** Typewriter reveal — adaptive speed: slow for small chunks, faster for large backlogs. */
export function TypewriterText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(0);
  const targetRef = useRef(text.length);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    targetRef.current = text.length;
    if (rafRef.current) return; // already animating
    const step = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const dt = time - lastTimeRef.current;
      if (dt >= 25) { // ~40fps cap to avoid too-fast updates
        lastTimeRef.current = time;
        setRevealed((prev) => {
          const remaining = targetRef.current - prev;
          if (remaining <= 0) { rafRef.current = 0; return prev; }
          // Adaptive: 1 char when <20 behind, ramp up for larger backlogs
          const speed = remaining < 20 ? 1 : remaining < 80 ? 2 : Math.ceil(remaining * 0.08);
          return Math.min(prev + speed, targetRef.current);
        });
      }
      if (rafRef.current) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [text]);

  useEffect(() => {
    if (text.length < revealed) { setRevealed(0); lastTimeRef.current = 0; }
  }, [text.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{text.slice(0, revealed)}</>;
}
