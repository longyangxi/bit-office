import { TILE_SIZE, MATRIX_EFFECT_DURATION, CharacterState, Direction } from '../types'
import type { Character, Seat, FurnitureInstance, TileType as TileTypeVal, OfficeLayout, PlacedFurniture } from '../types'
import { createCharacter, updateCharacter } from './characters'
import { matrixEffectSeeds } from './matrixEffect'
import { isWalkable, getWalkableTiles, findPath } from '../layout/tileMap'
import {
  createDefaultLayout,
  layoutToTileMap,
  layoutToFurnitureInstances,
  layoutToSeats,
  getBlockedTiles,
} from '../layout/layoutSerializer'
import { getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog'
import {
  PALETTE_COUNT,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  SPEECH_BUBBLE_DURATION_SEC,
  SPEECH_BUBBLE_MAX_CHARS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from '../constants'
import type { AgentStatus } from '@office/shared'

/**
 * Bridge between our Zustand store (string agentIds) and the pixel-agents
 * engine (numeric Character.id). Manages the office layout, characters,
 * seat assignments, and matrix effects.
 */
export class OfficeState {
  layout: OfficeLayout
  backgroundImage: HTMLImageElement | null = null
  tileMap: TileTypeVal[][]
  seats: Map<string, Seat>
  blockedTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  characters: Map<number, Character> = new Map()
  selectedCharId: number | null = null
  hoveredCharId: number | null = null
  /** Scale factor for characters relative to default map size */
  characterScale = 1

  // ── Agent ID mapping ──────────────────────────────────────────
  private agentIdToCharId = new Map<string, number>()
  private charIdToAgentId = new Map<number, string>()
  private nextCharId = 1

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout()
    this.tileMap = layoutToTileMap(this.layout)
    this.seats = layoutToSeats(this.layout.furniture)
    this.blockedTiles = getBlockedTiles(this.layout.furniture)
    this.furniture = layoutToFurnitureInstances(this.layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.characterScale = this.computeCharacterScale()
  }

  private computeCharacterScale(): number {
    const defaultSize = Math.max(DEFAULT_COLS, DEFAULT_ROWS)
    const currentSize = Math.max(this.layout.cols, this.layout.rows)
    if (currentSize <= defaultSize) return 1
    return Math.pow(currentSize / defaultSize, 0.75)
  }

  /** Set background image (from room ZIP import) */
  setBackgroundImage(img: HTMLImageElement | null): void {
    this.backgroundImage = img
  }

  /** Hot-replace layout: rebuild tileMap, seats, furniture, reassign characters */
  setLayout(layout: OfficeLayout): void {
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.characterScale = this.computeCharacterScale()
    this.seats = layoutToSeats(layout.furniture)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.furniture = layoutToFurnitureInstances(layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)

    // Reassign characters to seats and relocate to valid positions
    for (const ch of this.characters.values()) {
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) {
          seat.assigned = true
        } else {
          // Old seat no longer exists — try to find a new one
          ch.seatId = null
          const newSeatId = this.findFreeSeat()
          if (newSeatId) {
            const newSeat = this.seats.get(newSeatId)!
            newSeat.assigned = true
            ch.seatId = newSeatId
          }
        }
      }

      // Relocate character to a valid position in the new layout
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)!
        ch.tileCol = seat.seatCol
        ch.tileRow = seat.seatRow
        ch.dir = seat.facingDir
      } else if (this.walkableTiles.length > 0) {
        const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
        ch.tileCol = spawn.col
        ch.tileRow = spawn.row
      }
      ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2
      ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2
      ch.path = []
      ch.moveProgress = 0
    }
    this.rebuildFurnitureInstances()
  }

  // ── Public API (string agentId) ───────────────────────────────

  addCharacter(agentId: string, _name: string, palette?: number, isExternal?: boolean, label?: string, labelColor?: string): void {
    if (this.agentIdToCharId.has(agentId)) return

    const charId = this.nextCharId++
    this.agentIdToCharId.set(agentId, charId)
    this.charIdToAgentId.set(charId, agentId)

    const { palette: pickedPalette, hueShift } = palette !== undefined
      ? { palette, hueShift: 0 }
      : this.pickDiversePalette()

    // All agents start idle and wandering — work seats are assigned only when they become active
    const spawn = this.walkableTiles.length > 0
      ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
      : { col: 1, row: 1 }
    const ch = createCharacter(charId, pickedPalette, null, null, hueShift, CharacterState.IDLE)
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
    ch.tileCol = spawn.col
    ch.tileRow = spawn.row

    // Mark as external if applicable
    if (isExternal) {
      ch.isExternal = true
    }
    if (label) ch.label = label
    if (labelColor) ch.labelColor = labelColor

    // Matrix spawn effect
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()

    this.characters.set(charId, ch)
  }

  removeCharacter(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return

    const ch = this.characters.get(charId)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return // already despawning

    // Free seat
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
    }

    if (this.selectedCharId === charId) this.selectedCharId = null

    // Start despawn animation
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    ch.bubbleType = null
  }

  updateCharacterStatus(agentId: string, status: AgentStatus, keepSeat?: boolean): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return

    const wasActive = ch.isActive
    const isNowActive = status === 'working' || status === 'waiting_approval'

    ch.isActive = isNowActive

    // Team members always need a seat — assign one if they don't have one yet,
    // regardless of current status. This avoids a race condition where the bridge
    // misses a brief "working" transition (leader finishes delegation in seconds).
    if (keepSeat && !ch.seatId) {
      if (ch.restSeatId) {
        const rs = this.seats.get(ch.restSeatId)
        if (rs) rs.assigned = false
        ch.restSeatId = null
        ch.seatTimer = 0
      }
      const seatId = this.findFreeSeat()
      if (seatId) {
        const seat = this.seats.get(seatId)!
        seat.assigned = true
        ch.seatId = seatId
      }
      this.rebuildFurnitureInstances()
    }

    if (!isNowActive && wasActive) {
      if (keepSeat) {
        // Team member: keep their seat between tasks
      } else {
        // Solo agent: release work seat so others can use it
        if (ch.seatId) {
          const seat = this.seats.get(ch.seatId)
          if (seat) seat.assigned = false
          ch.seatId = null
        }
        ch.seatTimer = -1
        ch.path = []
        ch.moveProgress = 0
      }
      this.rebuildFurnitureInstances()
    } else if (isNowActive && !wasActive) {
      // Just became active — find a free work seat
      if (!ch.seatId) {
        // Release rest seat if sitting on one
        if (ch.restSeatId) {
          const rs = this.seats.get(ch.restSeatId)
          if (rs) rs.assigned = false
          ch.restSeatId = null
          ch.seatTimer = 0
        }
        const seatId = this.findFreeSeat()
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }
      this.rebuildFurnitureInstances()
    }
  }

  selectCharacter(agentId: string | null): void {
    if (agentId === null) {
      this.selectedCharId = null
      return
    }
    const charId = this.agentIdToCharId.get(agentId)
    this.selectedCharId = charId ?? null
  }

  showBubble(agentId: string, type: 'permission' | 'working' | 'waiting'): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return

    if (type === 'permission' || type === 'working') {
      ch.bubbleType = type
      ch.bubbleTimer = 0  // persistent, no countdown
    } else {
      ch.bubbleType = 'waiting'
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC
    }
  }

  clearBubble(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    if (ch.bubbleType === 'permission' || ch.bubbleType === 'working') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    } else if (ch.bubbleType === 'waiting') {
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC)
    }
  }

  showSpeechBubble(agentId: string, text: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    const truncated = text.length > SPEECH_BUBBLE_MAX_CHARS
      ? text.slice(0, SPEECH_BUBBLE_MAX_CHARS) + '...'
      : text
    ch.speechText = truncated
    ch.speechTimer = SPEECH_BUBBLE_DURATION_SEC
  }

  // ── Getters for renderer ──────────────────────────────────────

  getCharacters(): Character[] {
    return Array.from(this.characters.values())
  }

  getLayout(): OfficeLayout {
    return this.layout
  }

  getSelectedCharId(): number | null {
    return this.selectedCharId
  }

  getHoveredCharId(): number | null {
    return this.hoveredCharId
  }

  /** Get the string agentId for a character (numeric) id */
  getAgentId(charId: number): string | null {
    return this.charIdToAgentId.get(charId) ?? null
  }

  /** Get character at pixel position (for hit testing). Returns agentId or null. */
  getAgentAtPixel(worldX: number, worldY: number): string | null {
    const s = this.characterScale
    const chars = this.getCharacters().sort((a, b) => b.y - a.y)
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return this.charIdToAgentId.get(ch.id) ?? null
      }
    }
    return null
  }

  /** Set hovered character by numeric id (for outline rendering) */
  setHoveredCharAtPixel(worldX: number, worldY: number): void {
    const s = this.characterScale
    const chars = this.getCharacters().sort((a, b) => b.y - a.y)
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        this.hoveredCharId = ch.id
        return
      }
    }
    this.hoveredCharId = null
  }

  // ── Update loop ───────────────────────────────────────────────

  update(dt: number): void {
    const toDelete: number[] = []
    for (const ch of this.characters.values()) {
      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            ch.matrixEffect = null
            ch.matrixEffectTimer = 0
            ch.matrixEffectSeeds = []
          } else {
            toDelete.push(ch.id)
          }
        }
        continue
      }

      // Active character without a work seat — try to claim one
      if (ch.isActive && !ch.seatId && ch.state === CharacterState.IDLE) {
        const seatId = this.findFreeSeat()
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }

      // Temporarily unblock own seat so character can pathfind to it
      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, this.blockedTiles, this.characterScale, () => this.findFreeRestSeat())
      )

      // Tick bubble timer
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null
          ch.bubbleTimer = 0
        }
      }

      // Tick speech bubble timer
      if (ch.speechText) {
        ch.speechTimer -= dt
        if (ch.speechTimer <= 0) {
          ch.speechText = null
          ch.speechTimer = 0
        }
      }
    }

    // Remove characters that finished despawn
    for (const id of toDelete) {
      const agentId = this.charIdToAgentId.get(id)
      this.characters.delete(id)
      if (agentId) {
        this.agentIdToCharId.delete(agentId)
        this.charIdToAgentId.delete(id)
      }
    }
  }

  // ── Test helpers ─────────────────────────────────────────────

  /** Spawn test characters to fill all work seats (for layout testing) */
  spawnTestCharacters(): void {
    // Clear existing test characters
    this.clearTestCharacters()

    let idx = 0
    for (const [uid, seat] of this.seats) {
      if (seat.isRest || seat.assigned) continue
      const agentId = `__test_${idx}`
      const charId = this.nextCharId++
      this.agentIdToCharId.set(agentId, charId)
      this.charIdToAgentId.set(charId, agentId)

      const palette = idx % PALETTE_COUNT
      seat.assigned = true
      const ch = createCharacter(charId, palette, uid, seat, 0, CharacterState.TYPE)
      ch.isActive = true
      this.characters.set(charId, ch)
      idx++
    }
    this.rebuildFurnitureInstances()
  }

  /** Remove all test characters */
  clearTestCharacters(): void {
    const toRemove: string[] = []
    for (const [agentId, charId] of this.agentIdToCharId) {
      if (!agentId.startsWith('__test_')) continue
      const ch = this.characters.get(charId)
      if (ch?.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      this.characters.delete(charId)
      this.charIdToAgentId.delete(charId)
      toRemove.push(agentId)
    }
    for (const id of toRemove) this.agentIdToCharId.delete(id)
    if (toRemove.length > 0) this.rebuildFurnitureInstances()
  }

  /** Check if test characters are active */
  hasTestCharacters(): boolean {
    for (const agentId of this.agentIdToCharId.keys()) {
      if (agentId.startsWith('__test_')) return true
    }
    return false
  }


  // ── Private helpers ───────────────────────────────────────────

  private findFreeSeat(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned && !seat.isRest) return uid
    }
    return null
  }

  /** Find a free rest seat (sofa, etc.) for idle characters */
  findFreeRestSeat(): string | null {
    const restSeats = [...this.seats.entries()].filter(([, s]) => s.isRest && !s.assigned)
    if (restSeats.length === 0) return null
    // Pick a random one
    const [uid] = restSeats[Math.floor(Math.random() * restSeats.length)]
    return uid
  }

  private pickDiversePalette(): { palette: number; hueShift: number } {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue
      counts[ch.palette]++
    }
    const minCount = Math.min(...counts)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null
    const seat = this.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch)
    // Also unblock rest seat target if character is heading to one
    const restKey = ch.restSeatId ? (() => {
      const rs = this.seats.get(ch.restSeatId!)
      return rs ? `${rs.seatCol},${rs.seatRow}` : null
    })() : null
    if (key) this.blockedTiles.delete(key)
    if (restKey) this.blockedTiles.delete(restKey)
    const result = fn()
    if (key) this.blockedTiles.add(key)
    if (restKey) this.blockedTiles.add(restKey)
    return result
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    const autoOnTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat) continue
      const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        autoOnTiles.add(`${seat.seatCol + dCol * d},${seat.seatRow + dRow * d}`)
      }
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d
        const baseRow = seat.seatRow + dRow * d
        if (dCol !== 0) {
          autoOnTiles.add(`${baseCol},${baseRow - 1}`)
          autoOnTiles.add(`${baseCol},${baseRow + 1}`)
        } else {
          autoOnTiles.add(`${baseCol - 1},${baseRow}`)
          autoOnTiles.add(`${baseCol + 1},${baseRow}`)
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture)
      return
    }

    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type)
      if (!entry) return item
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type)
            if (onType !== item.type) {
              return { ...item, type: onType }
            }
            return item
          }
        }
      }
      return item
    })

    this.furniture = layoutToFurnitureInstances(modifiedFurniture)
  }
}
