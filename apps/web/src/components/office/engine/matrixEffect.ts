import type { Character, SpriteData } from '../types'
import { MATRIX_EFFECT_DURATION } from '../types'
import {
  MATRIX_TRAIL_LENGTH,
  MATRIX_SPRITE_COLS,
  MATRIX_SPRITE_ROWS,
  MATRIX_FLICKER_FPS,
  MATRIX_FLICKER_VISIBILITY_THRESHOLD,
  MATRIX_COLUMN_STAGGER_RANGE,
  MATRIX_HEAD_COLOR,
  MATRIX_TRAIL_OVERLAY_ALPHA,
  MATRIX_TRAIL_EMPTY_ALPHA,
  MATRIX_TRAIL_MID_THRESHOLD,
  MATRIX_TRAIL_DIM_THRESHOLD,
} from '../constants'

// ── Pre-cached RGBA strings ────────────────────────────────────
// Avoids creating `rgba(...)` strings on every pixel every frame.

const RGBA_CACHE_SIZE = 101 // 0..100 (alpha in %)

/** Bright green trail: rgba(0, 255, 65, alpha) */
const greenBrightCache: string[] = new Array(RGBA_CACHE_SIZE)
/** Mid green trail: rgba(0, 170, 40, alpha) */
const greenMidCache: string[] = new Array(RGBA_CACHE_SIZE)
/** Dim green trail: rgba(0, 85, 20, alpha) */
const greenDimCache: string[] = new Array(RGBA_CACHE_SIZE)

for (let i = 0; i < RGBA_CACHE_SIZE; i++) {
  const a = (i / 100).toFixed(2)
  greenBrightCache[i] = `rgba(0,255,65,${a})`
  greenMidCache[i] = `rgba(0,170,40,${a})`
  greenDimCache[i] = `rgba(0,85,20,${a})`
}

function greenBright(alpha: number): string {
  return greenBrightCache[Math.round(Math.min(1, Math.max(0, alpha)) * 100)]
}
function greenMid(alpha: number): string {
  return greenMidCache[Math.round(Math.min(1, Math.max(0, alpha)) * 100)]
}
function greenDim(alpha: number): string {
  return greenDimCache[Math.round(Math.min(1, Math.max(0, alpha)) * 100)]
}

/** Pick trail color based on trailPos threshold */
function trailColor(trailPos: number, alpha: number): string {
  if (trailPos < MATRIX_TRAIL_MID_THRESHOLD) return greenBright(alpha)
  if (trailPos < MATRIX_TRAIL_DIM_THRESHOLD) return greenMid(alpha)
  return greenDim(alpha)
}

// ── Flicker ────────────────────────────────────────────────────

/** Hash-based flicker: ~70% visible for shimmer effect */
function flickerVisible(col: number, row: number, time: number): boolean {
  const t = Math.floor(time * MATRIX_FLICKER_FPS)
  const hash = ((col * 7 + row * 13 + t * 31) & 0xff)
  return hash < MATRIX_FLICKER_VISIBILITY_THRESHOLD
}

function generateSeeds(): number[] {
  const seeds: number[] = []
  for (let i = 0; i < MATRIX_SPRITE_COLS; i++) {
    seeds.push(Math.random())
  }
  return seeds
}

export { generateSeeds as matrixEffectSeeds }

/**
 * Render a character with a Matrix-style digital rain spawn/despawn effect.
 */
export function renderMatrixEffect(
  ctx: CanvasRenderingContext2D,
  ch: Character,
  spriteData: SpriteData,
  drawX: number,
  drawY: number,
  zoom: number,
): void {
  const progress = ch.matrixEffectTimer / MATRIX_EFFECT_DURATION
  const isSpawn = ch.matrixEffect === 'spawn'
  const time = ch.matrixEffectTimer
  const totalSweep = MATRIX_SPRITE_ROWS + MATRIX_TRAIL_LENGTH

  for (let col = 0; col < MATRIX_SPRITE_COLS; col++) {
    const stagger = (ch.matrixEffectSeeds[col] ?? 0) * MATRIX_COLUMN_STAGGER_RANGE
    const colProgress = Math.max(0, Math.min(1, (progress - stagger) / (1 - MATRIX_COLUMN_STAGGER_RANGE)))
    const headRow = colProgress * totalSweep

    for (let row = 0; row < MATRIX_SPRITE_ROWS; row++) {
      const pixel = spriteData[row]?.[col]
      const hasPixel = pixel && pixel !== ''
      const distFromHead = headRow - row
      const px = drawX + col * zoom
      const py = drawY + row * zoom

      if (isSpawn) {
        if (distFromHead < 0) {
          continue
        } else if (distFromHead < 1) {
          ctx.fillStyle = MATRIX_HEAD_COLOR
          ctx.fillRect(px, py, zoom, zoom)
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH
          if (hasPixel) {
            ctx.fillStyle = pixel
            ctx.fillRect(px, py, zoom, zoom)
            const greenAlpha = (1 - trailPos) * MATRIX_TRAIL_OVERLAY_ALPHA
            if (flickerVisible(col, row, time)) {
              ctx.fillStyle = greenBright(greenAlpha)
              ctx.fillRect(px, py, zoom, zoom)
            }
          } else {
            if (flickerVisible(col, row, time)) {
              const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA
              ctx.fillStyle = trailColor(trailPos, alpha)
              ctx.fillRect(px, py, zoom, zoom)
            }
          }
        } else {
          if (hasPixel) {
            ctx.fillStyle = pixel
            ctx.fillRect(px, py, zoom, zoom)
          }
        }
      } else {
        if (distFromHead < 0) {
          if (hasPixel) {
            ctx.fillStyle = pixel
            ctx.fillRect(px, py, zoom, zoom)
          }
        } else if (distFromHead < 1) {
          ctx.fillStyle = MATRIX_HEAD_COLOR
          ctx.fillRect(px, py, zoom, zoom)
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          if (flickerVisible(col, row, time)) {
            const trailPos = distFromHead / MATRIX_TRAIL_LENGTH
            const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA
            ctx.fillStyle = trailColor(trailPos, alpha)
            ctx.fillRect(px, py, zoom, zoom)
          }
        }
      }
    }
  }
}
