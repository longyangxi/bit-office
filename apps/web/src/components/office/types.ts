export {
  TILE_SIZE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_COLS,
  MAX_ROWS,
  MATRIX_EFFECT_DURATION_SEC as MATRIX_EFFECT_DURATION,
} from './constants'

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  VOID: 8,
} as const
export type TileType = (typeof TileType)[keyof typeof TileType]

/** Per-tile color settings for floor pattern colorization */
export interface FloorColor {
  /** Hue: 0-360 in colorize mode, -180 to +180 in adjust mode */
  h: number
  /** Saturation: 0-100 in colorize mode, -100 to +100 in adjust mode */
  s: number
  /** Brightness -100 to 100 */
  b: number
  /** Contrast -100 to 100 */
  c: number
  /** When true, use Photoshop-style Colorize (grayscale → fixed HSL). Default: adjust mode. */
  colorize?: boolean
}

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
} as const
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState]

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const
export type Direction = (typeof Direction)[keyof typeof Direction]

/** 2D array of hex color strings (or '' for transparent). [row][col] */
export type SpriteData = string[][]

export interface Seat {
  /** Chair furniture uid */
  uid: string
  /** Tile col where agent sits */
  seatCol: number
  /** Tile row where agent sits */
  seatRow: number
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction
  assigned: boolean
}

export interface FurnitureInstance {
  sprite: SpriteData
  /** Pixel x (top-left) */
  x: number
  /** Pixel y (top-left) */
  y: number
  /** Y value used for depth sorting (typically bottom edge) */
  zY: number
}

export interface ToolActivity {
  toolId: string
  status: string
  done: boolean
  permissionWait?: boolean
}

export const FurnitureType = {
  DESK: 'desk',
  BOOKSHELF: 'bookshelf',
  PLANT: 'plant',
  COOLER: 'cooler',
  WHITEBOARD: 'whiteboard',
  CHAIR: 'chair',
  PC: 'pc',
  LAMP: 'lamp',
  // Tileset furniture types
  TS_DESK_WOOD: 'ts-desk-wood',
  TS_DESK_GRAY: 'ts-desk-gray',
  TS_TABLE_LONG: 'ts-table-long',
  TS_BOOKSHELF: 'ts-bookshelf',
  TS_CABINET: 'ts-cabinet',
  TS_BOOKSHELF_COLOR: 'ts-bookshelf-color',
  TS_COUCH_RED: 'ts-couch-red',
  TS_COUCH_BLUE: 'ts-couch-blue',
  TS_CHAIR_GREEN: 'ts-chair-green',
  TS_CHAIR_OFFICE: 'ts-chair-office',
  TS_COMPUTER: 'ts-computer',
  TS_LAPTOP: 'ts-laptop',
  TS_MONITOR: 'ts-monitor',
  TS_PHONE: 'ts-phone',
  TS_PLANT: 'ts-plant',
  TS_PLANT_TALL: 'ts-plant-tall',
  TS_PAINTING: 'ts-painting',
  TS_FRAME_SMALL: 'ts-frame-small',
  TS_CLOCK: 'ts-clock',
  TS_COOLER: 'ts-cooler',
  TS_BOXES: 'ts-boxes',
  TS_WHITEBOARD: 'ts-whiteboard',
} as const
export type FurnitureType = (typeof FurnitureType)[keyof typeof FurnitureType]

export interface FurnitureCatalogEntry {
  type: string
  label: string
  footprintW: number
  footprintH: number
  sprite: SpriteData
  isDesk: boolean
  category?: string
  orientation?: string
  canPlaceOnSurfaces?: boolean
  backgroundTiles?: number
  canPlaceOnWalls?: boolean
}

export interface PlacedFurniture {
  uid: string
  type: string
  col: number
  row: number
  color?: FloorColor
}

export interface OfficeLayout {
  version: 1
  cols: number
  rows: number
  tiles: number[]
  furniture: PlacedFurniture[]
  tileColors?: Array<FloorColor | null>
  /** Extra overlay layers from Tiled import (flat arrays, GID+100 encoded) */
  tiledLayers?: number[][]
  /** Tileset PNG as base64 data URL for persistence */
  tiledTilesetDataUrl?: string
  /** Tileset metadata for reconstructing sprites */
  tiledTilesetMeta?: { tileW: number; tileH: number; columns: number }
}

export const EditTool = {
  SELECT: 'select',
  TILE_PAINT: 'tile_paint',
  WALL_PAINT: 'wall_paint',
  ERASE: 'erase',
  FURNITURE_PLACE: 'furniture_place',
  FURNITURE_PICK: 'furniture_pick',
  EYEDROPPER: 'eyedropper',
} as const
export type EditTool = (typeof EditTool)[keyof typeof EditTool]

export interface Character {
  id: number
  state: CharacterState
  dir: Direction
  /** Pixel position */
  x: number
  y: number
  /** Current tile column */
  tileCol: number
  /** Current tile row */
  tileRow: number
  /** Remaining path steps (tile coords) */
  path: Array<{ col: number; row: number }>
  /** 0-1 lerp between current tile and next tile */
  moveProgress: number
  /** Current tool name for typing vs reading animation, or null */
  currentTool: string | null
  /** Palette index (0-5) */
  palette: number
  /** Hue shift in degrees (0 = no shift, ≥45 for repeated palettes) */
  hueShift: number
  /** Animation frame index */
  frame: number
  /** Time accumulator for animation */
  frameTimer: number
  /** Timer for idle wander decisions */
  wanderTimer: number
  /** Number of wander moves completed in current roaming cycle */
  wanderCount: number
  /** Max wander moves before returning to seat for rest */
  wanderLimit: number
  /** Whether the agent is actively working */
  isActive: boolean
  /** Assigned seat uid, or null if no seat */
  seatId: string | null
  /** Active speech bubble type, or null if none showing */
  bubbleType: 'permission' | 'working' | 'waiting' | null
  /** Countdown timer for bubble (waiting: 2→0, permission/working: unused) */
  bubbleTimer: number
  /** Text shown in speech bubble above character, or null */
  speechText: string | null
  /** Countdown timer for speech bubble (counts down to 0 then clears) */
  speechTimer: number
  /** Timer to stay seated while inactive after seat reassignment (counts down to 0) */
  seatTimer: number
  /** Whether this character represents a sub-agent (spawned by Task tool) */
  isSubagent: boolean
  /** Parent agent ID if this is a sub-agent, null otherwise */
  parentAgentId: number | null
  /** Active matrix spawn/despawn effect, or null */
  matrixEffect: 'spawn' | 'despawn' | null
  /** Timer counting up from 0 to MATRIX_EFFECT_DURATION */
  matrixEffectTimer: number
  /** Per-column random seeds (16 values) for staggered rain timing */
  matrixEffectSeeds: number[]
  /** Whether this character represents an external (non-managed) process */
  isExternal: boolean
  /** Label shown above character (agent name or PID for external) */
  label: string | null
  /** Background color for the label badge */
  labelColor: string | null
}
