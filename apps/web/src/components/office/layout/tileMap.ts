import { TileType } from '../types'

/** Encode (col, row) as a single number for fast Set/Map lookups */
function tileKey(col: number, row: number): number {
  // Supports maps up to 1024 columns wide
  return (row << 10) | col
}

/** Check if a tile is walkable (floor, carpet, or doorway, and not blocked by furniture) */
export function isWalkable(
  col: number,
  row: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  const rows = tileMap.length
  const cols = rows > 0 ? tileMap[0].length : 0
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false
  const t = tileMap[row][col]
  if (t === TileType.WALL || t === TileType.VOID) return false
  if (blockedTiles.has(`${col},${row}`)) return false
  return true
}

/** Get walkable tile positions (grid coords) for wandering */
export function getWalkableTiles(
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  const rows = tileMap.length
  const cols = rows > 0 ? tileMap[0].length : 0
  const tiles: Array<{ col: number; row: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(c, r, tileMap, blockedTiles)) {
        tiles.push({ col: c, row: r })
      }
    }
  }
  return tiles
}

const DIRS = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
] as const

/** BFS pathfinding on 4-connected grid (no diagonals). Returns path excluding start, including end. */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) return []

  const endWalkable = isWalkable(endCol, endRow, tileMap, blockedTiles)
  if (!endWalkable) return []

  const startKey = tileKey(startCol, startRow)
  const endKey = tileKey(endCol, endRow)

  // Use numeric keys for visited set and parent map — much faster than string keys
  const visited = new Set<number>()
  visited.add(startKey)

  const parent = new Map<number, number>()
  // BFS queue using a flat array with head pointer (avoids shift() O(n) cost)
  const queue: number[] = [startCol, startRow]
  let head = 0

  while (head < queue.length) {
    const currCol = queue[head++]
    const currRow = queue[head++]
    const currKey = tileKey(currCol, currRow)

    if (currKey === endKey) {
      // Reconstruct path
      const path: Array<{ col: number; row: number }> = []
      let k = endKey
      while (k !== startKey) {
        path.push({ col: k & 0x3ff, row: k >> 10 })
        k = parent.get(k)!
      }
      path.reverse()
      return path
    }

    for (const d of DIRS) {
      const nc = currCol + d.dc
      const nr = currRow + d.dr
      const nk = tileKey(nc, nr)

      if (visited.has(nk)) continue
      if (!isWalkable(nc, nr, tileMap, blockedTiles)) continue

      visited.add(nk)
      parent.set(nk, currKey)
      queue.push(nc, nr)
    }
  }

  return []
}
