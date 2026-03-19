import { MAX_DELTA_TIME_SEC } from '../constants'

export interface GameLoopCallbacks {
  update: (dt: number) => void
  render: (ctx: CanvasRenderingContext2D) => void
  /** Optional: return true if the scene needs re-rendering this frame */
  isDirty?: () => boolean
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let stopped = false
  /** Force render on first frame and after resize */
  let forceRender = true

  // Mark dirty on resize so the scene redraws at new dimensions
  const ro = new ResizeObserver(() => { forceRender = true })
  ro.observe(canvas)

  const frame = (time: number) => {
    if (stopped) return
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)
    lastTime = time

    callbacks.update(dt)

    // Only render when something changed
    const dirty = forceRender || !callbacks.isDirty || callbacks.isDirty()
    if (dirty) {
      forceRender = false
      ctx.imageSmoothingEnabled = false
      callbacks.render(ctx)
    }

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)

  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
    ro.disconnect()
  }
}
