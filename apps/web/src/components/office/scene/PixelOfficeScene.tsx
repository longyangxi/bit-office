"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { OfficeState } from "../engine/officeState";
import { startGameLoop } from "../engine/gameLoop";
import { renderFrame } from "../engine/renderer";
import type { EditorRenderState } from "../engine/renderer";
import { EditTool } from "../types";
import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX, PAN_ENABLED } from "../constants";
import { loadAllAssets } from "../sprites/assetLoader";
import { registerTilesetSprites, getCatalogEntry, isRotatable } from "../layout/furnitureCatalog";
import { EditorState } from "../editor/editorState";
import { getFurnitureAtTile } from "../editor/editorActions";
import type { SceneComponentProps } from "./SceneAdapter";
import { PixelSceneAdapter } from "./PixelSceneAdapter";

export interface PixelOfficeSceneProps extends SceneComponentProps {
  editMode: boolean;
  editorRef: React.MutableRefObject<EditorState>;
  onTileClick?: (col: number, row: number) => void;
  onTileRightClick?: (col: number, row: number) => void;
  onGhostMove?: (col: number, row: number) => void;
  onDragStart?: (col: number, row: number) => void;
  onDragMove?: (col: number, row: number) => void;
  onDragEnd?: (col: number, row: number) => void;
  onDeleteBtnClick?: () => void;
  onRotateBtnClick?: () => void;
  officeStateRef: React.MutableRefObject<OfficeState | null>;
  onAssetsLoaded?: () => void;
  zoomRef: React.MutableRefObject<number>;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

export default function PixelOfficeScene({
  onAdapterReady,
  onAgentClick,
  editMode,
  editorRef,
  onTileClick,
  onTileRightClick,
  onGhostMove,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDeleteBtnClick,
  onRotateBtnClick,
  officeStateRef,
  onAssetsLoaded,
  zoomRef,
  panRef,
}: PixelOfficeSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  // Stable callback refs
  const onAgentClickRef = useRef(onAgentClick);
  onAgentClickRef.current = onAgentClick;
  const onAssetsLoadedRef = useRef(onAssetsLoaded);
  onAssetsLoadedRef.current = onAssetsLoaded;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  // Camera state
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const lastOffsetsRef = useRef({ offsetX: 0, offsetY: 0 });
  const editorRenderRef = useRef<EditorRenderState | null>(null);
  /** Wake the game loop from sleep on user interaction */
  const wakeRef = useRef<(() => void) | null>(null);

  /** Calculate zoom so the map fills the viewport (contain fit) */
  const calcFitZoom = useCallback((viewW: number, viewH: number) => {
    const office = officeStateRef.current;
    if (!office) return 4;
    const mapW = office.layout.cols * TILE_SIZE;
    const mapH = office.layout.rows * TILE_SIZE;
    return Math.max(ZOOM_MIN, Math.min(viewW / mapW, viewH / mapH));
  }, [officeStateRef]);

  // Resize handler
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
    // Auto-fit zoom — renderer already centers the map, so reset pan to origin
    zoomRef.current = calcFitZoom(w, h);
    panRef.current = { x: 0, y: 0 };
  }, [calcFitZoom, zoomRef, panRef]);

  // Load assets on mount
  useEffect(() => {
    let cancelled = false;
    loadAllAssets()
      .then((assets) => {
        if (cancelled) return;
        registerTilesetSprites(assets.tilesetSprites);
        setAssetsLoaded(true);
      })
      .catch((err) => {
        console.warn("[PixelOfficeScene] Asset loading failed, using fallbacks:", err);
        if (!cancelled) {
          setAssetsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init game loop once assets are loaded
  useEffect(() => {
    if (!assetsLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Init state — start with empty default, office zip will be loaded via onAssetsLoaded
    const officeState = new OfficeState();
    officeStateRef.current = officeState;

    // Now that OfficeState exists, notify parent to load office zip
    onAssetsLoadedRef.current?.();

    // Setup canvas size — use ResizeObserver to react to container size changes
    // (window resize, sidebar open/close, etc.)
    resizeCanvas();
    const ro = new ResizeObserver(() => resizeCanvas());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // Start game loop
    const dpr = window.devicePixelRatio || 1;
    const { stop, wake } = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt);
      },
      isDirty: (() => {
        let prevZoom = 0;
        let prevPanX = 0;
        let prevPanY = 0;
        let prevGhostCol = -1;
        let prevGhostRow = -1;
        let prevSelectedUid: string | null = null;
        return () => {
          // Check if camera changed (pan/zoom)
          const z = zoomRef.current;
          const px = panRef.current.x;
          const py = panRef.current.y;
          const cameraMoved = z !== prevZoom || px !== prevPanX || py !== prevPanY;
          prevZoom = z; prevPanX = px; prevPanY = py;

          if (officeState.dirty || cameraMoved) {
            officeState.dirty = false;
            return true;
          }
          // Edit mode: only dirty when ghost/selection actually changed
          if (editModeRef.current) {
            const editor = editorRef.current;
            const ghostMoved = editor.ghostCol !== prevGhostCol || editor.ghostRow !== prevGhostRow;
            const selChanged = editor.selectedFurnitureUid !== prevSelectedUid;
            prevGhostCol = editor.ghostCol;
            prevGhostRow = editor.ghostRow;
            prevSelectedUid = editor.selectedFurnitureUid;
            return ghostMoved || selChanged;
          }
          return false;
        };
      })(),
      render: (ctx) => {
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;
        const zoom = zoomRef.current;
        const pan = panRef.current;

        const editor = editorRef.current;
        const isEdit = editModeRef.current;

        let editorRenderState: EditorRenderState | undefined;
        if (isEdit) {
          // Build ghost sprite from catalog
          let ghostSprite = null;
          const ghostTool = editor.activeTool;
          if (ghostTool === EditTool.FURNITURE_PLACE && editor.selectedFurnitureType) {
            const entry = getCatalogEntry(editor.selectedFurnitureType);
            if (entry) ghostSprite = entry.sprite;
          }
          // During drag, use the dragged item's sprite
          if (editor.dragUid) {
            const dragItem = officeState.layout.furniture.find((f) => f.uid === editor.dragUid);
            if (dragItem) {
              const entry = getCatalogEntry(dragItem.type);
              if (entry) ghostSprite = entry.sprite;
            }
          }

          // Build selection info
          let hasSelection = false;
          let selectedCol = 0, selectedRow = 0, selectedW = 1, selectedH = 1;
          let selIsRotatable = false;
          if (editor.selectedFurnitureUid) {
            const selItem = officeState.layout.furniture.find((f) => f.uid === editor.selectedFurnitureUid);
            if (selItem) {
              const selEntry = getCatalogEntry(selItem.type);
              hasSelection = true;
              selectedCol = selItem.col;
              selectedRow = selItem.row;
              selectedW = selEntry?.footprintW ?? 1;
              selectedH = selEntry?.footprintH ?? 1;
              selIsRotatable = isRotatable(selItem.type);
            }
          }

          editorRenderState = {
            showGrid: true,
            ghostSprite,
            ghostCol: editor.ghostCol,
            ghostRow: editor.ghostRow,
            ghostValid: editor.ghostValid,
            hasSelection,
            selectedCol,
            selectedRow,
            selectedW,
            selectedH,
            isRotatable: selIsRotatable,
            deleteButtonBounds: null,
            rotateButtonBounds: null,
            showGhostBorder: true,
            ghostBorderHoverCol: editor.ghostCol,
            ghostBorderHoverRow: editor.ghostRow,
          };
        }

        const result = renderFrame(
          ctx,
          cw,
          ch,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          pan.x,
          pan.y,
          officeState.getSelectedCharId(),
          officeState.getHoveredCharId(),
          officeState.layout.tileColors,
          officeState.layout.cols,
          officeState.layout.rows,
          editorRenderState,
          officeState.backgroundImage,
          officeState.characterScale,
        );
        lastOffsetsRef.current = result;
        editorRenderRef.current = editorRenderState ?? null;
      },
    });

    // Store wake for mouse/pointer handlers and officeState notifications
    wakeRef.current = wake;
    officeState.onDirty = wake;

    // Create adapter and notify parent
    const adapter = new PixelSceneAdapter(officeState, stop, wake);
    onAdapterReady(adapter);

    return () => {
      adapter.dispose();
      officeStateRef.current = null;
      ro.disconnect();
    };
  }, [assetsLoaded, resizeCanvas, officeStateRef, zoomRef, panRef, editorRef, onAdapterReady]);

  // ── Mouse/Touch handlers ──────────────────────────────────────

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const zoom = zoomRef.current;
    const { offsetX, offsetY } = lastOffsetsRef.current;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - offsetX) / zoom,
      y: (sy - offsetY) / zoom,
    };
  }, [zoomRef]);

  const worldToTile = useCallback((worldX: number, worldY: number) => {
    return {
      col: Math.floor(worldX / TILE_SIZE),
      row: Math.floor(worldY / TILE_SIZE),
    };
  }, []);

  const screenToTile = useCallback((clientX: number, clientY: number) => {
    const world = screenToWorld(clientX, clientY);
    return worldToTile(world.x, world.y);
  }, [screenToWorld, worldToTile]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };

    // Editor: start drag on selected furniture
    if (editModeRef.current && editorRef.current.selectedFurnitureUid) {
      const tile = screenToTile(e.clientX, e.clientY);
      const layout = officeStateRef.current?.layout;
      if (layout) {
        const fAtTile = getFurnitureAtTile(layout, tile.col, tile.row);
        if (fAtTile && fAtTile.uid === editorRef.current.selectedFurnitureUid) {
          onDragStart?.(tile.col, tile.row);
        }
      }
    }
  }, [panRef, editorRef, officeStateRef, screenToTile, onDragStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const officeState = officeStateRef.current;

    // Update hover (non-edit mode)
    if (officeState && !editModeRef.current) {
      const world = screenToWorld(e.clientX, e.clientY);
      officeState.setHoveredCharAtPixel(world.x, world.y);
      if (officeState.dirty) wakeRef.current?.();
    }

    // Editor: ghost preview + drag
    if (editModeRef.current) {
      const tile = screenToTile(e.clientX, e.clientY);
      if (editorRef.current.dragUid) {
        onDragMove?.(tile.col, tile.row);
      } else {
        onGhostMove?.(tile.col, tile.row);
      }
    }

    if (!isPanningRef.current) return;
    if (!PAN_ENABLED) return;
    if (editorRef.current.dragUid) return; // don't pan while dragging furniture

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panRef.current = {
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    };
    wakeRef.current?.();
  }, [screenToWorld, screenToTile, officeStateRef, panRef, editorRef, onDragMove, onGhostMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const wasPanning = isPanningRef.current;
    isPanningRef.current = false;

    // Editor: end drag
    if (editorRef.current.dragUid) {
      const tile = screenToTile(e.clientX, e.clientY);
      onDragEnd?.(tile.col, tile.row);
      return;
    }

    // Only count as click if didn't drag significantly
    const dx = Math.abs(e.clientX - panStartRef.current.x);
    const dy = Math.abs(e.clientY - panStartRef.current.y);
    if (wasPanning && (dx > 5 || dy > 5)) return;

    const officeState = officeStateRef.current;
    if (!officeState) return;

    // Editor mode: tile click
    if (editModeRef.current) {
      // Check selection button hit-test first
      const ers = editorRenderRef.current;
      if (ers) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          if (ers.deleteButtonBounds) {
            const { cx, cy, radius } = ers.deleteButtonBounds;
            if (Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2) <= radius) {
              onDeleteBtnClick?.();
              return;
            }
          }
          if (ers.rotateButtonBounds) {
            const { cx, cy, radius } = ers.rotateButtonBounds;
            if (Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2) <= radius) {
              onRotateBtnClick?.();
              return;
            }
          }
        }
      }

      const tile = screenToTile(e.clientX, e.clientY);
      onTileClick?.(tile.col, tile.row);
      return;
    }

    // Normal mode: agent click
    const world = screenToWorld(e.clientX, e.clientY);
    const agentId = officeState.getAgentAtPixel(world.x, world.y);
    if (agentId) {
      onAgentClickRef.current(agentId);
    }
  }, [screenToWorld, screenToTile, officeStateRef, editorRef, onTileClick, onDragEnd, onDeleteBtnClick, onRotateBtnClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!editModeRef.current) return;
    e.preventDefault();
    const tile = screenToTile(e.clientX, e.clientY);
    onTileRightClick?.(tile.col, tile.row);
  }, [screenToTile, onTileRightClick]);

  const handleWheel = useCallback((_e: React.WheelEvent) => {
    // Zoom via scroll wheel disabled for now
  }, []);

  // Touch zoom/pan
  const touchesRef = useRef<React.Touch[]>([]);
  const pinchDistRef = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchesRef.current = Array.from(e.touches);
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    }
  }, [panRef]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist - pinchDistRef.current;
      if (Math.abs(delta) > 20) {
        const direction = delta > 0 ? 1 : -1;
        zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current + direction));
        pinchDistRef.current = dist;
        wakeRef.current?.();
      }
    } else if (e.touches.length === 1 && isPanningRef.current && PAN_ENABLED) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      panRef.current = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
      wakeRef.current?.();
    }
  }, [zoomRef, panRef]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0 && touchesRef.current.length === 1) {
      const touch = touchesRef.current[0];
      const dx = Math.abs(touch.clientX - panStartRef.current.x);
      const dy = Math.abs(touch.clientY - panStartRef.current.y);
      if (dx < 10 && dy < 10) {
        if (editModeRef.current) {
          const tile = screenToTile(touch.clientX, touch.clientY);
          onTileClick?.(tile.col, tile.row);
        } else {
          const officeState = officeStateRef.current;
          if (officeState) {
            const world = screenToWorld(touch.clientX, touch.clientY);
            const agentId = officeState.getAgentAtPixel(world.x, world.y);
            if (agentId) {
              onAgentClickRef.current(agentId);
            }
          }
        }
      }
    }
    isPanningRef.current = false;
    touchesRef.current = Array.from(e.touches);
  }, [screenToWorld, screenToTile, officeStateRef, onTileClick]);

  const cursorStyle = editMode
    ? editorRef.current.activeTool === EditTool.ERASE ? "crosshair"
    : editorRef.current.activeTool === EditTool.EYEDROPPER ? "copy"
    : editorRef.current.activeTool === EditTool.FURNITURE_PLACE ? "cell"
    : editorRef.current.dragUid ? "grabbing"
    : "default"
    : "grab";

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", backgroundColor: "#12121f" }}>
      {!assetsLoaded && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b7280",
          fontSize: 14,
          fontFamily: "system-ui, sans-serif",
          zIndex: 10,
        }}>
          Loading office...
        </div>
      )}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: cursorStyle,
        }}
      />
    </div>
  );
}
