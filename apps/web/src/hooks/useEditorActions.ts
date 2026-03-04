import { useCallback, useRef } from 'react'
import { EditTool, TileType } from '@/components/office/types'
import type { OfficeLayout, FloorColor, PlacedFurniture } from '@/components/office/types'
import { EditorState } from '@/components/office/editor/editorState'
import { loadTiledMap } from '@/components/office/layout/tiledLoader'
import { setTiledSprites } from '@/components/office/floorTiles'
import {
  paintTile,
  placeFurniture,
  removeFurniture,
  moveFurniture,
  rotateFurniture,
  canPlaceFurniture,
  getFurnitureAtTile,
  expandLayout,
  getWallPlacementRow,
} from '@/components/office/editor/editorActions'
import type { ExpandDirection } from '@/components/office/editor/editorActions'
import { getCatalogEntry, isRotatable } from '@/components/office/layout/furnitureCatalog'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '@/components/office/constants'
import type { OfficeState } from '@/components/office/engine/officeState'
import { nanoid } from 'nanoid'

const LAYOUT_STORAGE_KEY = 'office-layout'

export function saveLayoutToStorage(layout: OfficeLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch { /* quota exceeded */ }
}

export function loadLayoutFromStorage(): OfficeLayout | null {
  try {
    const json = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!json) return null
    const obj = JSON.parse(json)
    if (obj && obj.version === 1) return obj as OfficeLayout
  } catch { /* ignore */ }
  return null
}

export function useEditorActions(
  editorRef: React.MutableRefObject<EditorState>,
  officeStateRef: React.MutableRefObject<OfficeState | null>,
  onLayoutChange: () => void,
) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getLayout = useCallback((): OfficeLayout | null => {
    return officeStateRef.current?.layout ?? null
  }, [officeStateRef])

  const applyLayout = useCallback((newLayout: OfficeLayout) => {
    const office = officeStateRef.current
    if (!office) return
    office.setLayout(newLayout)
    editorRef.current.isDirty = true
    onLayoutChange()

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveLayoutToStorage(newLayout)
    }, LAYOUT_SAVE_DEBOUNCE_MS)
  }, [officeStateRef, editorRef, onLayoutChange])

  /** Handle a tile click based on the active tool */
  const handleTileClick = useCallback((col: number, row: number) => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout) return

    const tool = editor.activeTool

    // Grid expansion for ghost border clicks
    if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) {
      let direction: ExpandDirection | null = null
      if (row < 0) direction = 'up'
      else if (row >= layout.rows) direction = 'down'
      else if (col < 0) direction = 'left'
      else if (col >= layout.cols) direction = 'right'
      if (direction) {
        editor.pushUndo(layout)
        editor.clearRedo()
        const result = expandLayout(layout, direction)
        if (result) applyLayout(result.layout)
      }
      return
    }

    switch (tool) {
      case EditTool.TILE_PAINT: {
        editor.pushUndo(layout)
        editor.clearRedo()
        applyLayout(paintTile(layout, col, row, editor.selectedTileType, editor.floorColor))
        break
      }
      case EditTool.WALL_PAINT: {
        editor.pushUndo(layout)
        editor.clearRedo()
        const idx = row * layout.cols + col
        const currentTile = layout.tiles[idx]
        if (currentTile === TileType.WALL) {
          // Toggle wall off → floor
          applyLayout(paintTile(layout, col, row, TileType.FLOOR_1, editor.floorColor))
        } else {
          // Paint wall
          applyLayout(paintTile(layout, col, row, TileType.WALL, editor.wallColor))
        }
        break
      }
      case EditTool.ERASE: {
        editor.pushUndo(layout)
        editor.clearRedo()
        // Remove furniture at tile first
        const furn = getFurnitureAtTile(layout, col, row)
        let newLayout = layout
        if (furn) {
          newLayout = removeFurniture(newLayout, furn.uid)
        }
        // Set tile to VOID
        newLayout = paintTile(newLayout, col, row, TileType.VOID)
        applyLayout(newLayout)
        break
      }
      case EditTool.FURNITURE_PLACE: {
        if (editor.selectedFurnitureType) {
          const entry = getCatalogEntry(editor.selectedFurnitureType)
          if (entry) {
            const placeRow = entry.canPlaceOnWalls ? getWallPlacementRow(editor.selectedFurnitureType, row) : row
            if (canPlaceFurniture(layout, editor.selectedFurnitureType, col, placeRow)) {
              editor.pushUndo(layout)
              editor.clearRedo()
              const item: PlacedFurniture = {
                uid: `f-${nanoid(6)}`,
                type: editor.selectedFurnitureType,
                col,
                row: placeRow,
                ...(editor.pickedFurnitureColor ? { color: editor.pickedFurnitureColor } : {}),
              }
              applyLayout(placeFurniture(layout, item))
            }
          }
        }
        break
      }
      case EditTool.SELECT: {
        const furniture = getFurnitureAtTile(layout, col, row)
        editor.selectedFurnitureUid = furniture?.uid ?? null
        onLayoutChange() // trigger re-render for selection
        break
      }
      case EditTool.EYEDROPPER: {
        const idx = row * layout.cols + col
        const tile = layout.tiles[idx]
        if (tile !== undefined && tile !== TileType.WALL && tile !== TileType.VOID) {
          editor.selectedTileType = tile
          const color = layout.tileColors?.[idx]
          if (color) editor.floorColor = { ...color }
          editor.activeTool = EditTool.TILE_PAINT
        } else if (tile === TileType.WALL) {
          const color = layout.tileColors?.[idx]
          if (color) editor.wallColor = { ...color }
          editor.activeTool = EditTool.WALL_PAINT
        }
        onLayoutChange()
        break
      }
      case EditTool.FURNITURE_PICK: {
        const furn = getFurnitureAtTile(layout, col, row)
        if (furn) {
          editor.selectedFurnitureType = furn.type
          editor.pickedFurnitureColor = furn.color ?? null
          editor.activeTool = EditTool.FURNITURE_PLACE
          onLayoutChange()
        }
        break
      }
    }
  }, [editorRef, getLayout, applyLayout, onLayoutChange])

  /** Handle right-click (erase) */
  const handleRightClick = useCallback((col: number, row: number) => {
    const layout = getLayout()
    if (!layout) return
    if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return
    const editor = editorRef.current
    editor.pushUndo(layout)
    editor.clearRedo()
    const furn = getFurnitureAtTile(layout, col, row)
    let newLayout = layout
    if (furn) {
      newLayout = removeFurniture(newLayout, furn.uid)
    }
    newLayout = paintTile(newLayout, col, row, TileType.VOID)
    applyLayout(newLayout)
  }, [editorRef, getLayout, applyLayout])

  /** Delete selected furniture */
  const handleDeleteSelected = useCallback(() => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout || !editor.selectedFurnitureUid) return
    editor.pushUndo(layout)
    editor.clearRedo()
    applyLayout(removeFurniture(layout, editor.selectedFurnitureUid))
    editor.selectedFurnitureUid = null
    onLayoutChange()
  }, [editorRef, getLayout, applyLayout, onLayoutChange])

  /** Rotate selected furniture */
  const handleRotateSelected = useCallback(() => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout || !editor.selectedFurnitureUid) return
    const item = layout.furniture.find((f) => f.uid === editor.selectedFurnitureUid)
    if (!item || !isRotatable(item.type)) return
    editor.pushUndo(layout)
    editor.clearRedo()
    applyLayout(rotateFurniture(layout, editor.selectedFurnitureUid))
  }, [editorRef, getLayout, applyLayout])

  /** Start dragging selected furniture */
  const handleDragStart = useCallback((col: number, row: number) => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout) return
    const furn = getFurnitureAtTile(layout, col, row)
    if (!furn) return
    editor.selectedFurnitureUid = furn.uid
    editor.startDrag(furn.uid, col, row, col - furn.col, row - furn.row)
    editor.pushUndo(layout)
    editor.clearRedo()
  }, [editorRef, getLayout])

  /** Move dragged furniture */
  const handleDragMove = useCallback((col: number, row: number) => {
    const editor = editorRef.current
    if (!editor.dragUid) return
    editor.isDragMoving = true
    const layout = getLayout()
    if (!layout) return
    const newCol = col - editor.dragOffsetCol
    const newRow = row - editor.dragOffsetRow
    const item = layout.furniture.find((f) => f.uid === editor.dragUid)
    if (item) {
      const entry = getCatalogEntry(item.type)
      editor.ghostCol = newCol
      editor.ghostRow = newRow
      editor.ghostValid = canPlaceFurniture(layout, item.type, newCol, newRow, editor.dragUid)
    }
  }, [editorRef, getLayout])

  /** End drag and apply move */
  const handleDragEnd = useCallback((col: number, row: number) => {
    const editor = editorRef.current
    if (!editor.dragUid) return
    const uid = editor.dragUid
    const wasMoved = editor.isDragMoving
    editor.clearDrag()
    editor.clearGhost()
    if (!wasMoved) return
    const layout = getLayout()
    if (!layout) return
    const newCol = col - editor.dragOffsetCol
    const newRow = row - editor.dragOffsetRow
    applyLayout(moveFurniture(layout, uid, newCol, newRow))
  }, [editorRef, getLayout, applyLayout])

  /** Update ghost preview position */
  const updateGhost = useCallback((col: number, row: number) => {
    const editor = editorRef.current
    if (editor.dragUid) return // don't update ghost while dragging

    if (editor.activeTool === EditTool.FURNITURE_PLACE && editor.selectedFurnitureType) {
      const layout = getLayout()
      if (!layout) return
      const entry = getCatalogEntry(editor.selectedFurnitureType)
      if (!entry) return
      const placeRow = entry.canPlaceOnWalls ? getWallPlacementRow(editor.selectedFurnitureType, row) : row
      editor.ghostCol = col
      editor.ghostRow = placeRow
      editor.ghostValid = canPlaceFurniture(layout, editor.selectedFurnitureType, col, placeRow)
    } else {
      editor.ghostCol = col
      editor.ghostRow = row
      editor.ghostValid = false
    }
  }, [editorRef, getLayout])

  /** Undo */
  const handleUndo = useCallback(() => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout) return
    const prev = editor.popUndo()
    if (!prev) return
    editor.pushRedo(layout)
    applyLayout(prev)
  }, [editorRef, getLayout, applyLayout])

  /** Redo */
  const handleRedo = useCallback(() => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout) return
    const next = editor.popRedo()
    if (!next) return
    editor.pushUndo(layout)
    applyLayout(next)
  }, [editorRef, getLayout, applyLayout])

  /** Import layout */
  const handleImportLayout = useCallback((newLayout: OfficeLayout) => {
    const editor = editorRef.current
    const layout = getLayout()
    if (layout) {
      editor.pushUndo(layout)
      editor.clearRedo()
    }
    applyLayout(newLayout)
  }, [editorRef, getLayout, applyLayout])

  /** Change selected furniture color */
  const handleSelectedFurnitureColorChange = useCallback((color: FloorColor | null) => {
    const editor = editorRef.current
    const layout = getLayout()
    if (!layout || !editor.selectedFurnitureUid) return
    editor.pushUndo(layout)
    editor.clearRedo()
    const newFurniture = layout.furniture.map((f) =>
      f.uid === editor.selectedFurnitureUid
        ? { ...f, color: color ?? undefined }
        : f
    )
    applyLayout({ ...layout, furniture: newFurniture })
  }, [editorRef, getLayout, applyLayout])

  /** Import Tiled map (.tmj + .tsj + .png) */
  const handleImportTiledMap = useCallback(async (files: FileList) => {
    try {
      const result = await loadTiledMap(files)
      setTiledSprites(result.tileSprites)

      const editor = editorRef.current
      const layout = getLayout()
      if (layout) {
        editor.pushUndo(layout)
        editor.clearRedo()
      }

      const newLayout: OfficeLayout = {
        version: 1,
        cols: result.cols,
        rows: result.rows,
        tiles: result.tiles,
        furniture: [],
        tileColors: new Array(result.tiles.length).fill(null),
        tiledLayers: result.overlayLayers,
        tiledTilesetDataUrl: result.tilesetDataUrl,
        tiledTilesetMeta: result.tilesetMeta,
      }
      applyLayout(newLayout)
    } catch (err) {
      console.error('[handleImportTiledMap]', err)
      alert(`Failed to import Tiled map: ${err instanceof Error ? err.message : err}`)
    }
  }, [editorRef, getLayout, applyLayout])

  return {
    handleTileClick,
    handleRightClick,
    handleDeleteSelected,
    handleRotateSelected,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    updateGhost,
    handleUndo,
    handleRedo,
    handleImportLayout,
    handleImportTiledMap,
    handleSelectedFurnitureColorChange,
  }
}
