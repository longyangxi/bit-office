"use client";

import { useState, useEffect } from "react";
import { TERM_DIM } from "./termTheme";

function LoadingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const timer = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 400);
    return () => clearInterval(timer);
  }, []);
  return <>{dots}</>;
}

/** Loading overlay with a random pixel character walking back and forth */
function LoadingOverlay({ visible }: { visible: boolean }) {
  const [charIdx, setCharIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [removed, setRemoved] = useState(false);

  // Pick random character only on client to avoid hydration mismatch
  useEffect(() => {
    setCharIdx(Math.floor(Math.random() * 6));
    setMounted(true);
  }, []);

  // When visible goes true again (e.g. office switch), reset fade state & pick new char
  useEffect(() => {
    if (visible) {
      setCharIdx(Math.floor(Math.random() * 6));
      setOpacity(1);
      setRemoved(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible && mounted) {
      // Fade out over 600ms
      const t1 = setTimeout(() => setOpacity(0), 50);
      const t2 = setTimeout(() => setRemoved(true), 700);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [visible, mounted]);

  if (removed || !mounted) return null;

  const sheetUrl = `/assets/characters/char_${charIdx}.png`;
  const zoom = 4;
  const displayW = 16 * zoom; // 64
  const displayH = 32 * zoom; // 128

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      zIndex: 50,
      background: "#0e0c1a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      opacity,
      transition: "opacity 0.6s ease",
      pointerEvents: visible ? "auto" : "none",
    }}>
      <style>{`
        @keyframes loading-walk-sprite {
          0%   { background-position-x: 0px; }
          25%  { background-position-x: -64px; }
          50%  { background-position-x: -128px; }
          75%  { background-position-x: -64px; }
          100% { background-position-x: 0px; }
        }
        @keyframes loading-walk-move {
          0%   { transform: translateX(-60px) scaleX(1); }
          45%  { transform: translateX(60px) scaleX(1); }
          50%  { transform: translateX(60px) scaleX(-1); }
          95%  { transform: translateX(-60px) scaleX(-1); }
          100% { transform: translateX(-60px) scaleX(1); }
        }
      `}</style>
      <div style={{ position: "relative", width: displayW, height: displayH }}>
        <div style={{
          width: displayW,
          height: displayH,
          backgroundImage: `url(${sheetUrl})`,
          backgroundSize: "448px 384px",
          backgroundPositionY: "-256px",
          imageRendering: "pixelated" as const,
          animation: "loading-walk-sprite 0.5s steps(1) infinite, loading-walk-move 3s linear infinite",
        }} />
      </div>
      <div style={{
        fontFamily: "monospace",
        fontSize: 13,
        color: TERM_DIM,
        letterSpacing: "0.05em",
      }}>
        Loading office<span style={{ display: "inline-block", width: "1.5em", textAlign: "left" }}>
          <LoadingDots />
        </span>
      </div>
    </div>
  );
}

export default LoadingOverlay;
