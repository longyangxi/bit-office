/**
 * Tiled (.tmj) map loader — parses Tiled export files and converts
 * them into bit-office compatible tile data + SpriteData map.
 *
 * Expected input: FileList containing .tmj, .tsj/.tsx, and .png files.
 * Output: flat tile arrays with GID+100 encoding and 16×16 SpriteData per GID.
 */

import { TileType, TILE_SIZE } from '../types'
import type { SpriteData } from '../types'

/** Offset added to Tiled GIDs when stored in bit-office tile arrays */
export const TILED_GID_OFFSET = 100

export interface TiledLoadResult {
  /** Bottom layer tile data (flat array, GID+100 encoded; 0 → TileType.VOID) */
  tiles: number[]
  /** Additional overlay layers (flat arrays, GID+100 encoded) */
  overlayLayers: number[][]
  cols: number
  rows: number
  /** GID → 16×16 SpriteData for rendering */
  tileSprites: Map<number, SpriteData>
  /** Tileset PNG as base64 data URL for serialization */
  tilesetDataUrl: string
  /** Tileset metadata for rebuilding sprites from data URL */
  tilesetMeta: { tileW: number; tileH: number; columns: number }
}

// ── Tiled JSON types (minimal) ────────────────────────────────

interface TiledMapJSON {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: TiledLayerJSON[]
  tilesets: Array<{ firstgid: number; source?: string }>
}

interface TiledLayerJSON {
  type: string
  data?: number[]
  width?: number
  height?: number
  name?: string
}

interface TiledTilesetJSON {
  tilewidth: number
  tileheight: number
  columns: number
  image: string
  imagewidth: number
  imageheight: number
  tilecount: number
}

// ── Main loader ───────────────────────────────────────────────

export async function loadTiledMap(files: FileList): Promise<TiledLoadResult> {
  const fileMap = new Map<string, File>()
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    fileMap.set(f.name.toLowerCase(), f)
  }

  // 1. Find .tmj file
  const tmjFile = findByExt(fileMap, '.tmj')
  if (!tmjFile) throw new Error('No .tmj file found')

  const mapJson: TiledMapJSON = JSON.parse(await readFileText(tmjFile))
  const { width: cols, height: rows } = mapJson

  // 2. Find & parse tileset (.tsj or .tsx JSON)
  let tilesetJson: TiledTilesetJSON | null = null

  // Try embedded tileset reference
  const tilesetRef = mapJson.tilesets[0]
  if (tilesetRef?.source) {
    const tsjName = tilesetRef.source.toLowerCase()
    const tsjFile = fileMap.get(tsjName) ?? findByExt(fileMap, '.tsj') ?? findByExt(fileMap, '.tsx')
    if (tsjFile) {
      tilesetJson = JSON.parse(await readFileText(tsjFile))
    }
  }

  // Fallback: find any .tsj or .tsx
  if (!tilesetJson) {
    const tsjFile = findByExt(fileMap, '.tsj') ?? findByExt(fileMap, '.tsx')
    if (tsjFile) {
      tilesetJson = JSON.parse(await readFileText(tsjFile))
    }
  }

  if (!tilesetJson) throw new Error('No tileset (.tsj/.tsx) file found')

  const { tilewidth: tileW, tileheight: tileH, columns: tsCols } = tilesetJson

  // 3. Load tileset PNG
  const pngFile = findByExt(fileMap, '.png')
  if (!pngFile) throw new Error('No .png tileset image found')

  const tilesetDataUrl = await readFileDataUrl(pngFile)
  const tilesetImg = await loadImage(tilesetDataUrl)

  // 4. Extract tile layers (only "tilelayer" type)
  const tileLayers = mapJson.layers.filter(
    (l) => l.type === 'tilelayer' && l.data && l.data.length > 0
  )

  if (tileLayers.length === 0) throw new Error('No tile layers found in .tmj')

  // 5. Collect unique GIDs across all layers
  const firstgid = tilesetRef?.firstgid ?? 1
  const uniqueGids = new Set<number>()
  for (const layer of tileLayers) {
    for (const rawGid of layer.data!) {
      // Strip Tiled flip flags (upper 3 bits)
      const gid = rawGid & 0x1FFFFFFF
      if (gid > 0) uniqueGids.add(gid)
    }
  }

  // 6. For each unique GID: extract tile from PNG → scale to 16×16 → SpriteData
  const tileSprites = new Map<number, SpriteData>()
  const extractCanvas = document.createElement('canvas')
  extractCanvas.width = TILE_SIZE
  extractCanvas.height = TILE_SIZE
  const extractCtx = extractCanvas.getContext('2d')!
  extractCtx.imageSmoothingEnabled = false

  for (const gid of uniqueGids) {
    const localId = gid - firstgid
    const srcCol = localId % tsCols
    const srcRow = Math.floor(localId / tsCols)
    const srcX = srcCol * tileW
    const srcY = srcRow * tileH

    // Draw scaled to 16×16
    extractCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)
    extractCtx.drawImage(tilesetImg, srcX, srcY, tileW, tileH, 0, 0, TILE_SIZE, TILE_SIZE)

    // Read pixels → SpriteData
    const imgData = extractCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
    const sprite: SpriteData = []
    for (let r = 0; r < TILE_SIZE; r++) {
      const row: string[] = []
      for (let c = 0; c < TILE_SIZE; c++) {
        const idx = (r * TILE_SIZE + c) * 4
        const a = imgData.data[idx + 3]
        if (a < 128) {
          row.push('')
        } else {
          const rr = imgData.data[idx]
          const gg = imgData.data[idx + 1]
          const bb = imgData.data[idx + 2]
          row.push(`#${hex2(rr)}${hex2(gg)}${hex2(bb)}`)
        }
      }
      sprite.push(row)
    }
    tileSprites.set(gid, sprite)
  }

  // 7. Build output: first layer → tiles[], rest → overlayLayers
  const encodedLayers: number[][] = tileLayers.map((layer) => {
    return layer.data!.map((rawGid) => {
      const gid = rawGid & 0x1FFFFFFF
      if (gid === 0) return TileType.VOID
      return gid + TILED_GID_OFFSET
    })
  })

  const tiles = encodedLayers[0]
  const overlayLayers = encodedLayers.slice(1)

  return {
    tiles,
    overlayLayers,
    cols,
    rows,
    tileSprites,
    tilesetDataUrl,
    tilesetMeta: { tileW, tileH, columns: tsCols },
  }
}

/**
 * Rebuild tileSprites map from a persisted tileset data URL and metadata.
 * Used when deserializing a layout that has Tiled data.
 */
export async function rebuildTiledSprites(
  tilesetDataUrl: string,
  meta: { tileW: number; tileH: number; columns: number },
  gids: Set<number>,
): Promise<Map<number, SpriteData>> {
  const img = await loadImage(tilesetDataUrl)
  const sprites = new Map<number, SpriteData>()

  const extractCanvas = document.createElement('canvas')
  extractCanvas.width = TILE_SIZE
  extractCanvas.height = TILE_SIZE
  const ctx = extractCanvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  for (const gid of gids) {
    const localId = gid - 1 // firstgid is always 1 for rebuilt data
    const srcCol = localId % meta.columns
    const srcRow = Math.floor(localId / meta.columns)
    const srcX = srcCol * meta.tileW
    const srcY = srcRow * meta.tileH

    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)
    ctx.drawImage(img, srcX, srcY, meta.tileW, meta.tileH, 0, 0, TILE_SIZE, TILE_SIZE)

    const imgData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
    const sprite: SpriteData = []
    for (let r = 0; r < TILE_SIZE; r++) {
      const row: string[] = []
      for (let c = 0; c < TILE_SIZE; c++) {
        const idx = (r * TILE_SIZE + c) * 4
        const a = imgData.data[idx + 3]
        if (a < 128) {
          row.push('')
        } else {
          const rr = imgData.data[idx]
          const gg = imgData.data[idx + 1]
          const bb = imgData.data[idx + 2]
          row.push(`#${hex2(rr)}${hex2(gg)}${hex2(bb)}`)
        }
      }
      sprite.push(row)
    }
    sprites.set(gid, sprite)
  }

  return sprites
}

/**
 * Collect all unique raw GIDs from tile arrays (decode from stored value).
 */
export function collectGidsFromTiles(tiles: number[], overlayLayers?: number[][]): Set<number> {
  const gids = new Set<number>()
  for (const v of tiles) {
    if (v >= TILED_GID_OFFSET) gids.add(v - TILED_GID_OFFSET)
  }
  if (overlayLayers) {
    for (const layer of overlayLayers) {
      for (const v of layer) {
        if (v >= TILED_GID_OFFSET) gids.add(v - TILED_GID_OFFSET)
      }
    }
  }
  return gids
}

// ── Helpers ───────────────────────────────────────────────────

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

function findByExt(fileMap: Map<string, File>, ext: string): File | undefined {
  for (const [name, file] of fileMap) {
    if (name.endsWith(ext)) return file
  }
  return undefined
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load tileset image'))
    img.src = src
  })
}
