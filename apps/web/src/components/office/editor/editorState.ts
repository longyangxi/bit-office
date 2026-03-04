import { EditTool, TileType } from '../types'
import type { EditTool as EditToolType, TileType as TileTypeVal, FloorColor, OfficeLayout } from '../types'
import { UNDO_STACK_MAX_SIZE, DEFAULT_FLOOR_COLOR, DEFAULT_WALL_COLOR } from '../constants'

export class EditorState {
  isEditMode = false
  activeTool: EditToolType = EditTool.SELECT
  selectedTileType: number = TileType.FLOOR_1
  selectedFurnitureType = 'desk'

  // Floor color settings
  floorColor: FloorColor = { ...DEFAULT_FLOOR_COLOR }

  // Wall color settings
  wallColor: FloorColor = { ...DEFAULT_WALL_COLOR }

  // Wall drag toggle direction (true=adding, false=removing, null=undecided)
  wallDragAdding: boolean | null = null

  // Picked furniture color (copied by pick tool)
  pickedFurnitureColor: FloorColor | null = null

  // Ghost preview position
  ghostCol = -1
  ghostRow = -1
  ghostValid = false

  // Selection
  selectedFurnitureUid: string | null = null

  // Mouse drag state (tile paint)
  isDragging = false

  // Undo / Redo stacks
  undoStack: OfficeLayout[] = []
  redoStack: OfficeLayout[] = []

  // Dirty flag
  isDirty = false

  // Drag-to-move state
  dragUid: string | null = null
  dragStartCol = 0
  dragStartRow = 0
  dragOffsetCol = 0
  dragOffsetRow = 0
  isDragMoving = false

  pushUndo(layout: OfficeLayout): void {
    this.undoStack.push(layout)
    if (this.undoStack.length > UNDO_STACK_MAX_SIZE) {
      this.undoStack.shift()
    }
  }

  popUndo(): OfficeLayout | null {
    return this.undoStack.pop() || null
  }

  pushRedo(layout: OfficeLayout): void {
    this.redoStack.push(layout)
    if (this.redoStack.length > UNDO_STACK_MAX_SIZE) {
      this.redoStack.shift()
    }
  }

  popRedo(): OfficeLayout | null {
    return this.redoStack.pop() || null
  }

  clearRedo(): void {
    this.redoStack = []
  }

  clearSelection(): void {
    this.selectedFurnitureUid = null
  }

  clearGhost(): void {
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
  }

  startDrag(uid: string, startCol: number, startRow: number, offsetCol: number, offsetRow: number): void {
    this.dragUid = uid
    this.dragStartCol = startCol
    this.dragStartRow = startRow
    this.dragOffsetCol = offsetCol
    this.dragOffsetRow = offsetRow
    this.isDragMoving = false
  }

  clearDrag(): void {
    this.dragUid = null
    this.isDragMoving = false
  }

  reset(): void {
    this.activeTool = EditTool.SELECT
    this.selectedFurnitureUid = null
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
    this.isDragging = false
    this.wallDragAdding = null
    this.undoStack = []
    this.redoStack = []
    this.isDirty = false
    this.dragUid = null
    this.isDragMoving = false
  }
}
