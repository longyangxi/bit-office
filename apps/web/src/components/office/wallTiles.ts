/**
 * Wall tile auto-tiling: sprite storage and bitmask-based piece selection.
 */

import type { SpriteData, TileType as TileTypeVal, FloorColor, FurnitureInstance } from './types'
import { TileType, TILE_SIZE } from './types'
import { getColorizedSprite } from './colorize'

/** 16 wall sprites indexed by bitmask (0-15) */
let wallSprites: SpriteData[] | null = null

/** Set wall sprites (called once when extension sends wallTilesLoaded) */
export function setWallSprites(sprites: SpriteData[]): void {
  wallSprites = sprites
}

/** Check if wall sprites have been loaded */
export function hasWallSprites(): boolean {
  return wallSprites !== null
}

/**
 * Get the wall sprite for a tile based on its cardinal neighbors.
 */
export function getWallSprite(
  col: number,
  row: number,
  tileMap: number[][],
): { sprite: SpriteData; offsetY: number } | null {
  if (!wallSprites) return null

  const tmRows = tileMap.length
  const tmCols = tmRows > 0 ? tileMap[0].length : 0

  let mask = 0
  if (row > 0 && tileMap[row - 1][col] === TileType.WALL) mask |= 1
  if (col < tmCols - 1 && tileMap[row][col + 1] === TileType.WALL) mask |= 2
  if (row < tmRows - 1 && tileMap[row + 1][col] === TileType.WALL) mask |= 4
  if (col > 0 && tileMap[row][col - 1] === TileType.WALL) mask |= 8

  const sprite = wallSprites[mask]
  if (!sprite) return null

  return { sprite, offsetY: TILE_SIZE - sprite.length }
}

/**
 * Get a colorized wall sprite for a tile based on its cardinal neighbors.
 */
export function getColorizedWallSprite(
  col: number,
  row: number,
  tileMap: number[][],
  color: FloorColor,
): { sprite: SpriteData; offsetY: number } | null {
  if (!wallSprites) return null

  const tmRows = tileMap.length
  const tmCols = tmRows > 0 ? tileMap[0].length : 0

  let mask = 0
  if (row > 0 && tileMap[row - 1][col] === TileType.WALL) mask |= 1
  if (col < tmCols - 1 && tileMap[row][col + 1] === TileType.WALL) mask |= 2
  if (row < tmRows - 1 && tileMap[row + 1][col] === TileType.WALL) mask |= 4
  if (col > 0 && tileMap[row][col - 1] === TileType.WALL) mask |= 8

  const sprite = wallSprites[mask]
  if (!sprite) return null

  const cacheKey = `wall-${mask}-${color.h}-${color.s}-${color.b}-${color.c}`
  const colorized = getColorizedSprite(cacheKey, sprite, { ...color, colorize: true })

  return { sprite: colorized, offsetY: TILE_SIZE - sprite.length }
}

/**
 * Build FurnitureInstance-like objects for all wall tiles so they can participate
 * in z-sorting with furniture and characters.
 */
export function getWallInstances(
  tileMap: number[][],
  tileColors?: Array<FloorColor | null>,
  cols?: number,
): FurnitureInstance[] {
  if (!wallSprites) return []
  const tmRows = tileMap.length
  const tmCols = tmRows > 0 ? tileMap[0].length : 0
  const layoutCols = cols ?? tmCols
  const instances: FurnitureInstance[] = []
  for (let r = 0; r < tmRows; r++) {
    for (let c = 0; c < tmCols; c++) {
      if (tileMap[r][c] !== TileType.WALL) continue
      const colorIdx = r * layoutCols + c
      const wallColor = tileColors?.[colorIdx]
      const wallInfo = wallColor
        ? getColorizedWallSprite(c, r, tileMap, wallColor)
        : getWallSprite(c, r, tileMap)
      if (!wallInfo) continue
      instances.push({
        sprite: wallInfo.sprite,
        x: c * TILE_SIZE,
        y: r * TILE_SIZE + wallInfo.offsetY,
        zY: (r + 1) * TILE_SIZE,
      })
    }
  }
  return instances
}

/**
 * Compute the flat fill hex color for a wall tile with a given FloorColor.
 */
export function wallColorToHex(color: FloorColor): string {
  const { h, s, b, c } = color
  let lightness = 0.5

  if (c !== 0) {
    const factor = (100 + c) / 100
    lightness = 0.5 + (lightness - 0.5) * factor
  }

  if (b !== 0) {
    lightness = lightness + b / 200
  }

  lightness = Math.max(0, Math.min(1, lightness))

  const satFrac = s / 100
  const ch = (1 - Math.abs(2 * lightness - 1)) * satFrac
  const hp = h / 60
  const x = ch * (1 - Math.abs(hp % 2 - 1))
  let r1 = 0, g1 = 0, b1 = 0

  if (hp < 1) { r1 = ch; g1 = x; b1 = 0 }
  else if (hp < 2) { r1 = x; g1 = ch; b1 = 0 }
  else if (hp < 3) { r1 = 0; g1 = ch; b1 = x }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = ch }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = ch }
  else { r1 = ch; g1 = 0; b1 = x }

  const m = lightness - ch / 2
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)))

  return `#${clamp(r1).toString(16).padStart(2, '0')}${clamp(g1).toString(16).padStart(2, '0')}${clamp(b1).toString(16).padStart(2, '0')}`
}
