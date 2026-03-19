import { MAX_DELTA_TIME_SEC } from '../constants'

/** Number of consecutive clean frames before the loop sleeps */
const IDLE_THRESHOLD = 10

export interface GameLoopCallbacks {
  update: (dt: number) => void
  render: (ctx: CanvasRenderingContext2D) => void
  /** Optional: return true if the scene needs re-rendering this frame */
  isDirty?: () => boolean
  /** Optional: return true if update() must keep running even when nothing is dirty
   *  (e.g. timers counting down). Prevents the loop from sleeping without
   *  forcing a full render each frame. */
  needsTick?: () => boolean
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): { stop: () => void; wake: () => void } {
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let stopped = false
  /** Force render on first frame and after resize */
  let forceRender = true
  /** Consecutive frames with no dirty state */
  let idleFrames = 0
  /** Whether the loop is currently sleeping (no rAF scheduled) */
  let sleeping = false

  // Mark dirty on resize so the scene redraws at new dimensions
  const ro = new ResizeObserver(() => {
    forceRender = true
    wake()
  })
  ro.observe(canvas)

  const frame = (time: number) => {
    if (stopped) return
    sleeping = false
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)
    lastTime = time

    callbacks.update(dt)

    // Only render when something changed
    const dirty = forceRender || !callbacks.isDirty || callbacks.isDirty()
    if (dirty) {
      idleFrames = 0
      forceRender = false
      ctx.imageSmoothingEnabled = false
      callbacks.render(ctx)
    } else {
      idleFrames++
    }

    // Sleep when idle — events will wake us via wake()
    if (idleFrames >= IDLE_THRESHOLD) {
      // Don't sleep if update() still needs ticking (e.g. wander timers)
      if (callbacks.needsTick?.()) {
        // Keep the loop alive for update() but don't render
        rafId = requestAnimationFrame(frame)
        return
      }
      sleeping = true
      lastTime = 0 // reset so next wake doesn't produce a huge dt
      return
    }

    rafId = requestAnimationFrame(frame)
  }

  /** Wake the loop from sleep. Safe to call even when already running. */
  function wake() {
    if (stopped) return
    if (!sleeping) {
      // Already running — just reset idle counter so we don't sleep soon
      idleFrames = 0
      return
    }
    sleeping = false
    idleFrames = 0
    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)

  return {
    stop: () => {
      stopped = true
      cancelAnimationFrame(rafId)
      ro.disconnect()
    },
    wake,
  }
}
