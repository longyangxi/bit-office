import { TileType, FurnitureType, TILE_SIZE, Direction, DEFAULT_COLS, DEFAULT_ROWS } from '../types'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, Seat, FurnitureInstance, FloorColor } from '../types'
import { getCatalogEntry } from './furnitureCatalog'
import { getColorizedSprite } from '../colorize'
import { rebuildTiledSprites, collectGidsFromTiles } from './tiledLoader'
import { setTiledSprites } from '../floorTiles'

// Migration color constants (used when old layouts lack tileColors)
const CONF_ROOM_COLOR: FloorColor = { h: 210, s: 20, b: 22, c: 0 }
const MAIN_FLOOR_COLOR: FloorColor = { h: 35, s: 30, b: 15, c: 0 }
const MEETING_ROOM_COLOR: FloorColor = { h: 150, s: 15, b: 20, c: 0 }
const DOORWAY_COLOR: FloorColor = { h: 30, s: 40, b: 25, c: 0 }
const LOBBY_COLOR: FloorColor = { h: 195, s: 10, b: 18, c: 0 }
const PRIVATE_OFFICE_COLOR: FloorColor = { h: 270, s: 15, b: 20, c: 0 }

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): number[][] {
  const map: number[][] = []
  for (let r = 0; r < layout.rows; r++) {
    const row: number[] = []
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c])
    }
    map.push(row)
  }
  return map
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  const deskZByTile = new Map<string, number>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    const deskZY = item.row * TILE_SIZE + entry.sprite.length
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        const prev = deskZByTile.get(key)
        if (prev === undefined || deskZY > prev) deskZByTile.set(key, deskZY)
      }
    }
  }

  const instances: FurnitureInstance[] = []
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const x = item.col * TILE_SIZE
    const y = item.row * TILE_SIZE
    const spriteH = entry.sprite.length
    let zY = y + spriteH

    if (entry.category === 'chairs') {
      if (entry.orientation === 'back') {
        zY = (item.row + 1) * TILE_SIZE + 1
      } else {
        zY = (item.row + 1) * TILE_SIZE
      }
    }

    if (entry.canPlaceOnSurfaces) {
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          const deskZ = deskZByTile.get(`${item.col + dc},${item.row + dr}`)
          if (deskZ !== undefined && deskZ + 0.5 > zY) zY = deskZ + 0.5
        }
      }
    }

    let sprite = entry.sprite
    if (item.color) {
      const { h, s, b: bv, c: cv } = item.color
      sprite = getColorizedSprite(`furn-${item.type}-${h}-${s}-${bv}-${cv}-${item.color.colorize ? 1 : 0}`, entry.sprite, item.color)
    }

    instances.push({ sprite, x, y, zY })
  }
  return instances
}

/** Get all tiles blocked by furniture footprints */
export function getBlockedTiles(furniture: PlacedFurniture[], excludeTiles?: Set<string>): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const bgRows = entry.backgroundTiles || 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        if (excludeTiles && excludeTiles.has(key)) continue
        tiles.add(key)
      }
    }
  }
  return tiles
}

/**
 * Get tiles blocked by all furniture except the one with the given uid.
 * Used for ghost preview validation when placing/moving furniture.
 */
export function getPlacementBlockedTiles(furniture: PlacedFurniture[], excludeUid?: string): Set<string> {
  const filtered = excludeUid ? furniture.filter((f) => f.uid !== excludeUid) : furniture
  return getBlockedTiles(filtered)
}

/** Map chair orientation to character facing direction */
function orientationToFacing(orientation: string): Direction {
  switch (orientation) {
    case 'front': return Direction.DOWN
    case 'back': return Direction.UP
    case 'left': return Direction.LEFT
    case 'right': return Direction.RIGHT
    default: return Direction.DOWN
  }
}

/** Generate seats from chair furniture. */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>()

  const deskTiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP },
    { dc: 0, dr: 1, facing: Direction.DOWN },
    { dc: -1, dr: 0, facing: Direction.LEFT },
    { dc: 1, dr: 0, facing: Direction.RIGHT },
  ]

  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || entry.category !== 'chairs') continue

    let seatCount = 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc
        const tileRow = item.row + dr

        let facingDir: Direction = Direction.DOWN
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation)
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing
              break
            }
          }
        }

        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          assigned: false,
        })
        seatCount++
      }
    }
  }

  return seats
}

/**
 * Simple fallback layout used when Level 4 JSON fails to load.
 * Uses only hardcoded furniture types (no tileset dependency).
 */
export function createDefaultLayout(): OfficeLayout {
  const COLS = DEFAULT_COLS
  const ROWS = DEFAULT_ROWS
  const W = TileType.WALL
  const F = TileType.FLOOR_1
  const V = TileType.VOID

  const tiles: TileTypeVal[] = []
  const tileColors: Array<FloorColor | null> = []
  const defaultColor: FloorColor = { h: 195, s: 10, b: 18, c: 0 }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isEdge = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1
      const tile = isEdge ? W : F
      tiles.push(tile)
      tileColors.push(tile === F ? defaultColor : null)
    }
  }

  // Generate desks + chairs in a grid pattern
  // Desk (2x2) at (col, row), chair (1x1) at (col, row+2)
  // Columns: 3, 7, 11, 15 — Rows: 2, 6, 10, 14
  const furniture: PlacedFurniture[] = []
  let deskIdx = 0
  const deskCols = [3, 7, 11, 15]
  const deskRows = [2, 6, 10, 14]
  for (const row of deskRows) {
    for (const col of deskCols) {
      deskIdx++
      furniture.push({ uid: `desk-${deskIdx}`, type: FurnitureType.DESK, col, row })
      furniture.push({ uid: `ch-${deskIdx}`, type: FurnitureType.CHAIR, col, row: row + 2 })
    }
  }
  // Decor along walls
  furniture.push({ uid: 'plant-1',  type: FurnitureType.PLANT, col: 1, row: 1 })
  furniture.push({ uid: 'plant-2',  type: FurnitureType.PLANT, col: 19, row: 1 })
  furniture.push({ uid: 'plant-3',  type: FurnitureType.PLANT, col: 1, row: 19 })
  furniture.push({ uid: 'plant-4',  type: FurnitureType.PLANT, col: 19, row: 19 })
  furniture.push({ uid: 'shelf-1',  type: FurnitureType.BOOKSHELF, col: 1, row: 9 })
  furniture.push({ uid: 'shelf-2',  type: FurnitureType.BOOKSHELF, col: 19, row: 9 })
  furniture.push({ uid: 'cooler-1', type: FurnitureType.COOLER, col: 10, row: 19 })
  furniture.push({ uid: 'wb-1',     type: FurnitureType.WHITEBOARD, col: 9, row: 1 })

  return { version: 1, cols: COLS, rows: ROWS, tiles, tileColors, furniture }
}

/** Serialize layout to JSON string */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout)
}

/** Deserialize layout from JSON string, migrating old tile types if needed */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      const layout = migrateLayout(obj as OfficeLayout)
      // Async rebuild of Tiled sprites (fire and forget — sprites will appear once loaded)
      if (layout.tiledTilesetDataUrl && layout.tiledTilesetMeta) {
        const gids = collectGidsFromTiles(layout.tiles, layout.tiledLayers)
        rebuildTiledSprites(layout.tiledTilesetDataUrl, layout.tiledTilesetMeta, gids)
          .then((sprites) => setTiledSprites(sprites))
          .catch((err) => console.warn('[deserializeLayout] Failed to rebuild Tiled sprites:', err))
      }
      return layout
    }
  } catch { /* ignore parse errors */ }
  return null
}

/** Ensure layout has tileColors. */
export function migrateLayoutColors(layout: OfficeLayout): OfficeLayout {
  return migrateLayout(layout)
}

function migrateLayout(layout: OfficeLayout): OfficeLayout {
  if (layout.tileColors && layout.tileColors.length === layout.tiles.length) {
    return layout
  }

  const tileColors: Array<FloorColor | null> = []
  for (const tile of layout.tiles) {
    switch (tile) {
      case 0:
        tileColors.push(null)
        break
      case 1:
        tileColors.push(CONF_ROOM_COLOR)
        break
      case 2:
        tileColors.push(MAIN_FLOOR_COLOR)
        break
      case 3:
        tileColors.push(MEETING_ROOM_COLOR)
        break
      case 4:
        tileColors.push(DOORWAY_COLOR)
        break
      case 5:
        tileColors.push(LOBBY_COLOR)
        break
      case 6:
        tileColors.push(PRIVATE_OFFICE_COLOR)
        break
      default:
        tileColors.push(tile > 0 ? { h: 0, s: 0, b: 0, c: 0 } : null)
    }
  }

  return { ...layout, tileColors }
}
