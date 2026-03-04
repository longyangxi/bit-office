/**
 * Floor tile pattern storage and caching.
 */

import type { SpriteData, FloorColor } from './types'
import { getColorizedSprite, clearColorizeCache } from './colorize'
import { TILE_SIZE, FALLBACK_FLOOR_COLOR } from './constants'

/** Default solid gray 16×16 tile used when floors.png is not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: TILE_SIZE },
  () => Array(TILE_SIZE).fill(FALLBACK_FLOOR_COLOR) as string[],
)

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = []

/** Wall color constant */
export const WALL_COLOR = '#3A3A5C'

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites
  clearColorizeCache()
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 -> array index 0-6). */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1
  if (idx < 0) return null
  if (idx < floorSprites.length) return floorSprites[idx]
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE
  return null
}

/** Check if floor sprites are available */
export function hasFloorSprites(): boolean {
  return true
}

/** Get count of available floor patterns */
export function getFloorPatternCount(): number {
  return floorSprites.length > 0 ? floorSprites.length : 1
}

/** Get all floor sprites */
export function getAllFloorSprites(): SpriteData[] {
  return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE]
}

/**
 * Get a colorized version of a floor sprite.
 */
export function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
  const key = `floor-${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`

  const base = getFloorSprite(patternIndex)
  if (!base) {
    const err: SpriteData = Array.from({ length: 16 }, () => Array(16).fill('#FF00FF'))
    return err
  }

  return getColorizedSprite(key, base, { ...color, colorize: true })
}

// ── Tiled sprite storage ──────────────────────────────────────

/** Module-level storage for Tiled GID → SpriteData mapping */
let tiledSprites: Map<number, SpriteData> = new Map()

/** Store sprites extracted from a Tiled tileset */
export function setTiledSprites(sprites: Map<number, SpriteData>): void {
  tiledSprites = sprites
}

/** Get a Tiled sprite by GID (raw GID, not +100 offset) */
export function getTiledSprite(gid: number): SpriteData | null {
  return tiledSprites.get(gid) ?? null
}

/** Check if any Tiled sprites are loaded */
export function hasTiledSprites(): boolean {
  return tiledSprites.size > 0
}

/** Clear all Tiled sprites */
export function clearTiledSprites(): void {
  tiledSprites = new Map()
}
