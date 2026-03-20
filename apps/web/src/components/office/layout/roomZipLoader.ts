/**
 * Loads a tileEditor room.zip and converts it to an OfficeLayout
 * with a background image and custom furniture sprites.
 *
 * The grid is imported 1:1 — no downsampling. The tileEditor cellSize
 * matches open-office TILE_SIZE (16px), so tiles and furniture positions
 * are preserved exactly.
 */

import JSZip from 'jszip'
import type { OfficeLayout, PlacedFurniture, SpriteData, FloorColor, TileType as TileTypeVal } from '../types'
import { TileType, TILE_SIZE } from '../types'
import { registerCustomSprites, getCatalogEntry, FURNITURE_CATALOG } from './furnitureCatalog'
import type { CatalogEntryWithCategory } from './furnitureCatalog'

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
  objects?: Array<{
    id: string
    type: string
    col: number
    row: number
    rotation?: number
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
 * Convert an image to SpriteData, scaling to fit within target size
 * while preserving the original aspect ratio. The image is bottom-aligned
 * within the target bounds (transparent padding on top if needed).
 */
function imageToSpriteData(img: HTMLImageElement, targetW: number, targetH: number): SpriteData {
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Scale to contain (preserve aspect ratio), bottom-aligned
  const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight)
  const drawW = Math.round(img.naturalWidth * scale)
  const drawH = Math.round(img.naturalHeight * scale)
  const drawX = Math.round((targetW - drawW) / 2)
  const drawY = targetH - drawH // bottom-aligned
  ctx.drawImage(img, drawX, drawY, drawW, drawH)

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

/** Map rotation degrees to orientation string */
function rotationToOrientation(rotation: number): string {
  switch (rotation % 360) {
    case 0: return 'front'
    case 90: return 'right'
    case 180: return 'back'
    case 270: return 'left'
    default: return 'front'
  }
}

/** Map tileEditor cell types to open-office TileType */
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
  const customSprites = new Map<string, { sprite: SpriteData; footprintW: number; footprintH: number; label: string; tag?: string }>()

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
        tag: tile.tag,
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

  // 6. Convert object markers (desk, chair, etc.) to placed furniture
  //    First, register oriented catalog entries (e.g. chair-left, desk-back)
  //    so that layoutToSeats can resolve orientation → facing direction.
  if (roomJson.objects) {
    const orientations = ['front', 'right', 'back', 'left'] as const
    const neededBaseTypes = new Set(roomJson.objects.map((o) => o.type))
    for (const baseType of neededBaseTypes) {
      const baseEntry = getCatalogEntry(baseType)
      if (!baseEntry) continue
      for (const orient of orientations) {
        // Always use suffixed type (e.g. chair-front, chair-left)
        // so that each entry has its own orientation property.
        const orientedType = `${baseType}-${orient}`
        if (getCatalogEntry(orientedType)) continue // already exists
        const entry: CatalogEntryWithCategory = {
          ...baseEntry,
          type: orientedType,
          orientation: orient,
          // Object markers are always 1x1 regardless of base entry footprint
          footprintW: 1,
          footprintH: 1,
        }
        FURNITURE_CATALOG.push(entry)
      }
    }

    for (const obj of roomJson.objects) {
      const orientSuffix = rotationToOrientation(obj.rotation ?? 0)
      const resolvedType = `${obj.type}-${orientSuffix}`

      furniture.push({
        uid: obj.id,
        type: resolvedType,
        col: obj.col,
        row: obj.row,
      })
    }
  }

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

/** Load a room zip from a URL (e.g. /offices/default.zip) */
export async function loadRoomZipFromUrl(url: string): Promise<RoomZipResult | null> {
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`[roomZipLoader] Failed to fetch ${url}: ${response.status}`)
    return null
  }
  const arrayBuffer = await response.arrayBuffer()
  // Create a File-like object from the ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: 'application/zip' })
  const file = new File([blob], url.split('/').pop() || 'room.zip', { type: 'application/zip' })
  return loadRoomZip(file)
}
