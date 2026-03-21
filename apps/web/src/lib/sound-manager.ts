/**
 * SoundManager — Web Audio API synthesized sound effects for office events.
 * Zero external dependencies, no audio files needed.
 */

type SoundType =
  | "taskStart"
  | "taskDone"
  | "taskFailed"
  | "approval"
  | "notification"
  | "delegation";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  // Resume suspended context (browser autoplay policy)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Create a gain-enveloped oscillator note */
function playTone(
  ac: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.15,
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// ── Sound Definitions ──

/** Rising arpeggio — cheerful "let's go" */
function soundTaskStart(ac: AudioContext) {
  const t = ac.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
  notes.forEach((f, i) => playTone(ac, f, t + i * 0.08, 0.18, "triangle", 0.12));
}

/** Major chord + sparkle — celebration */
function soundTaskDone(ac: AudioContext) {
  const t = ac.currentTime;
  // Chord: C5 E5 G5 C6
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    playTone(ac, f, t + i * 0.06, 0.35, "sine", 0.1),
  );
  // Sparkle overtone
  playTone(ac, 1318.5, t + 0.28, 0.25, "sine", 0.06);
}

/** Descending minor — something went wrong */
function soundTaskFailed(ac: AudioContext) {
  const t = ac.currentTime;
  const notes = [440, 370, 311]; // A4 F#4 Eb4
  notes.forEach((f, i) => playTone(ac, f, t + i * 0.12, 0.25, "sawtooth", 0.08));
}

/** Two gentle pings — needs your attention */
function soundApproval(ac: AudioContext) {
  const t = ac.currentTime;
  playTone(ac, 880, t, 0.15, "sine", 0.12);
  playTone(ac, 1108.73, t + 0.18, 0.2, "sine", 0.1); // C#6
}

/** Single bright chime */
function soundNotification(ac: AudioContext) {
  const t = ac.currentTime;
  playTone(ac, 1046.5, t, 0.12, "sine", 0.13); // C6
  playTone(ac, 1318.5, t + 0.1, 0.18, "sine", 0.09); // E6
}

/** Quick blip — task handed off */
function soundDelegation(ac: AudioContext) {
  const t = ac.currentTime;
  playTone(ac, 698.46, t, 0.08, "square", 0.07); // F5
  playTone(ac, 880, t + 0.07, 0.1, "square", 0.06); // A5
}

const SOUNDS: Record<SoundType, (ac: AudioContext) => void> = {
  taskStart: soundTaskStart,
  taskDone: soundTaskDone,
  taskFailed: soundTaskFailed,
  approval: soundApproval,
  notification: soundNotification,
  delegation: soundDelegation,
};

/**
 * Play a synthesized sound effect.
 * Safe to call in SSR (no-ops gracefully).
 */
export function playSound(type: SoundType): void {
  if (typeof window === "undefined") return;
  try {
    const ac = getCtx();
    SOUNDS[type](ac);
  } catch {
    // Silently fail — sound is non-critical
  }
}
