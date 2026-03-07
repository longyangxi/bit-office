/**
 * Loads a tileEditor room.zip and converts it to an OfficeLayout
 * with a background image and custom furniture sprites.
 *
 * The grid is imported 1:1 — no downsampling. The tileEditor cellSize
 * matches bit-office TILE_SIZE (16px), so tiles and furniture positions
 * are preserved exactly.
 */

import JSZip from 'jszip'
import type { OfficeLayout, PlacedFurniture, SpriteData, FloorColor, TileType as TileTypeVal } from '../types'
import { TileType, TILE_SIZE } from '../types'
import { registerCustomSprites } from './furnitureCatalog'

const PNG_ALPHA_THRESHOLD = 128

interface RoomJson {
  version: number
  name: string
  cellSize: number
  cols: number
  rows: number
  backgroundWidth: number
  backgroundHeight: number
  backgroundFile?: string
  tiles: number[]
  tileset?: Array<{
    id: string
    name: string
    file: string
    gridW: number
    gridH: number
    tag?: string
  }>
  furniture?: Array<{
    uid: string
    tileId: string
    name: string
    col: number
    row: number
    widthCells: number
    heightCells: number
  }>
}

export interface RoomZipResult {
  layout: OfficeLayout
  backgroundImage: HTMLImageElement | null
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image from blob'))
    }
    img.src = url
  })
}

/**
 * Convert an image to SpriteData, scaling to a target size.
 */
function imageToSpriteData(img: HTMLImageElement, targetW: number, targetH: number): SpriteData {
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, targetW, targetH)
  const imageData = ctx.getImageData(0, 0, targetW, targetH)
  const { data } = imageData

  const sprite: SpriteData = []
  for (let y = 0; y < targetH; y++) {
    const row: string[] = []
    for (let x = 0; x < targetW; x++) {
      const idx = (y * targetW + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (a < PNG_ALPHA_THRESHOLD) {
        row.push('')
      } else {
        row.push(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase(),
        )
      }
    }
    sprite.push(row)
  }
  return sprite
}

function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

/** Map tileEditor cell types to bit-office TileType */
function mapTileType(cell: number): number {
  if (cell === 0) return TileType.WALL
  if (cell === 8) return TileType.VOID
  if (cell >= 1 && cell <= 7) return cell
  return TileType.FLOOR_1
}

export async function loadRoomZip(file: File): Promise<RoomZipResult | null> {
  const zip = await JSZip.loadAsync(file)

  const roomJsonFile = zip.file('room.json')
  if (!roomJsonFile) {
    alert('Invalid room zip: missing room.json')
    return null
  }

  const roomJson: RoomJson = JSON.parse(await roomJsonFile.async('text'))
  if (!roomJson.cols || !roomJson.rows || !roomJson.tiles) {
    alert('Invalid room.json: missing cols/rows/tiles')
    return null
  }

  // 1. Load background image
  let backgroundImage: HTMLImageElement | null = null
  if (roomJson.backgroundFile) {
    const bgFile = zip.file(roomJson.backgroundFile)
    if (bgFile) {
      const ab = await bgFile.async('arraybuffer')
      const blob = new Blob([ab], { type: mimeFromFilename(roomJson.backgroundFile) })
      backgroundImage = await loadImageFromBlob(blob)
    }
  }

  // 2. Load tileset sprites and register them as custom furniture
  const customSprites = new Map<string, { sprite: SpriteData; footprintW: number; footprintH: number; label: string }>()

  if (roomJson.tileset) {
    for (const tile of roomJson.tileset) {
      if (!tile.file) continue
      const tileFile = zip.file(tile.file)
      if (!tileFile) continue
      const ab = await tileFile.async('arraybuffer')
      const blob = new Blob([ab], { type: mimeFromFilename(tile.file) })
      const img = await loadImageFromBlob(blob)
      const targetW = tile.gridW * TILE_SIZE
      const targetH = tile.gridH * TILE_SIZE
      const sprite = imageToSpriteData(img, targetW, targetH)
      customSprites.set(`room-${tile.id}`, {
        sprite,
        footprintW: tile.gridW,
        footprintH: tile.gridH,
        label: tile.name,
      })
    }
    if (customSprites.size > 0) {
      registerCustomSprites(customSprites)
    }
  }

  // 3. Map tile types (1:1, no downsampling)
  const tiles = roomJson.tiles.map(mapTileType)

  // 4. Generate default tileColors for floor tiles
  const defaultFloorColor: FloorColor = { h: 35, s: 30, b: 15, c: 0 }
  const tileColors: Array<FloorColor | null> = tiles.map((t) =>
    t === TileType.WALL || t === TileType.VOID ? null : defaultFloorColor,
  )

  // 5. Map furniture positions (1:1, no scaling)
  const furniture: PlacedFurniture[] = (roomJson.furniture || []).map((f) => ({
    uid: f.uid,
    type: `room-${f.tileId}`,
    col: f.col,
    row: f.row,
  }))

  const layout: OfficeLayout = {
    version: 1,
    cols: roomJson.cols,
    rows: roomJson.rows,
    tiles: tiles as TileTypeVal[],
    furniture,
    tileColors,
  }

  return { layout, backgroundImage }
}
