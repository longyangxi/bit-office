"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useOfficeStore } from "@/store/office-store";
import { OfficeState } from "./engine/officeState";
import { startGameLoop } from "./engine/gameLoop";
import { renderFrame } from "./engine/renderer";
import type { EditorRenderState } from "./engine/renderer";
import { EditTool } from "./types";
import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX, ZOOM_SCROLL_THRESHOLD } from "./constants";
import { loadAllAssets } from "./sprites/assetLoader";
import { registerTilesetSprites, getCatalogEntry, isRotatable } from "./layout/furnitureCatalog";
import { EditorState } from "./editor/editorState";
import { getFurnitureAtTile } from "./editor/editorActions";

/** Agent type colors for name badges */
const AGENT_TYPE_COLORS = {
  external: "#5aacff",
  team: "#d4a017",
  normal: "#8a7a6a",
};

function getAgentLabel(agent: { name: string; isExternal?: boolean; pid?: number; teamId?: string }): { label: string; color: string } {
  if (agent.isExternal) {
    return { label: `${agent.pid ?? "?"}`, color: AGENT_TYPE_COLORS.external };
  }
  const short = agent.name.split(/[\s(]/)[0];
  const color = agent.teamId ? AGENT_TYPE_COLORS.team : AGENT_TYPE_COLORS.normal;
  return { label: short, color };
}

interface OfficeCanvasProps {
  onAgentClick: (agentId: string) => void;
  selectedAgent: string | null;
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
  stateRef: React.MutableRefObject<OfficeState | null>;
  onAssetsLoaded?: () => void;
  zoomRef: React.MutableRefObject<number>;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

export default function OfficeCanvas({
  onAgentClick,
  selectedAgent,
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
  stateRef,
  onAssetsLoaded,
  zoomRef,
  panRef,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const knownAgentsRef = useRef<Set<string>>(new Set());
  const prevMsgCountRef = useRef<Map<string, number>>(new Map());
  const prevLogLineRef = useRef<Map<string, string | null>>(new Map());
  const prevTeamMsgCountRef = useRef(0);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const loadedLayoutRef = useRef<import('./types').OfficeLayout | null>(null);

  // Stable callback refs
  const onAgentClickRef = useRef(onAgentClick);
  onAgentClickRef.current = onAgentClick;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  // Camera state
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const lastOffsetsRef = useRef({ offsetX: 0, offsetY: 0 });
  const scrollAccRef = useRef(0);
  const editorRenderRef = useRef<EditorRenderState | null>(null);

  /** Calculate zoom so the map fills the viewport (contain fit) */
  const calcFitZoom = useCallback((viewW: number, viewH: number) => {
    const office = stateRef.current;
    if (!office) return 4;
    const mapW = office.layout.cols * TILE_SIZE;
    const mapH = office.layout.rows * TILE_SIZE;
    return Math.max(ZOOM_MIN, Math.floor(Math.min(viewW / mapW, viewH / mapH)));
  }, [stateRef]);

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
    // Auto-fit zoom on resize
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
        loadedLayoutRef.current = assets.layout;
        setAssetsLoaded(true);
        onAssetsLoaded?.();
      })
      .catch((err) => {
        console.warn("[OfficeCanvas] Asset loading failed, using fallbacks:", err);
        if (!cancelled) {
          setAssetsLoaded(true);
          onAssetsLoaded?.();
        }
      });
    return () => { cancelled = true; };
  }, [onAssetsLoaded]);

  // Init game loop once assets are loaded
  useEffect(() => {
    if (!assetsLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Init state (use loaded layout JSON if available)
    const officeState = new OfficeState(loadedLayoutRef.current ?? undefined);
    stateRef.current = officeState;

    // Setup canvas size
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Sync existing agents from store
    const state = useOfficeStore.getState();
    for (const [agentId, agent] of state.agents) {
      const { label, color: labelColor } = getAgentLabel(agent);
      officeState.addCharacter(agentId, agent.name, agent.palette, agent.isExternal, label, labelColor);
      officeState.updateCharacterStatus(agentId, agent.status);
      knownAgentsRef.current.add(agentId);
      // Seed message counts so persisted messages don't trigger speech bubbles
      prevMsgCountRef.current.set(agentId, agent.messages.length);
      prevLogLineRef.current.set(agentId, agent.lastLogLine ?? null);
    }
    // Seed team message count so old team messages don't replay as bubbles
    prevTeamMsgCountRef.current = state.teamMessages.length;

    // Start game loop
    const dpr = window.devicePixelRatio || 1;
    const stop = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt);
      },
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
        );
        lastOffsetsRef.current = result;
        editorRenderRef.current = editorRenderState ?? null;
      },
    });
    stopLoopRef.current = stop;

    return () => {
      stop();
      stopLoopRef.current = null;
      stateRef.current = null;
      knownAgentsRef.current.clear();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [assetsLoaded, resizeCanvas, stateRef, zoomRef, panRef, editorRef]);

  // Subscribe to Zustand store changes
  useEffect(() => {
    const unsub = useOfficeStore.subscribe((state) => {
      const officeState = stateRef.current;
      if (!officeState) return;

      const currentIds = new Set(state.agents.keys());

      for (const [agentId, agent] of state.agents) {
        if (!knownAgentsRef.current.has(agentId)) {
          const { label, color: labelColor } = getAgentLabel(agent);
          officeState.addCharacter(agentId, agent.name, agent.palette, agent.isExternal, label, labelColor);
          knownAgentsRef.current.add(agentId);
        }

        officeState.updateCharacterStatus(agentId, agent.status);

        if (agent.pendingApproval) {
          officeState.showBubble(agentId, "permission");
        } else if (agent.status === "working") {
          officeState.showBubble(agentId, "working");
        } else if (agent.status === "done") {
          officeState.showBubble(agentId, "waiting");
        } else if (agent.status === "error") {
          officeState.showBubble(agentId, "waiting");
        } else {
          officeState.clearBubble(agentId);
        }

        // Detect new agent messages → show speech bubble
        const prevCount = prevMsgCountRef.current.get(agentId) ?? 0;
        const curCount = agent.messages.length;
        if (curCount > prevCount) {
          const lastMsg = agent.messages[curCount - 1];
          if (lastMsg && lastMsg.role !== "user") {
            officeState.showSpeechBubble(agentId, lastMsg.text);
          }
        }
        prevMsgCountRef.current.set(agentId, curCount);

        // Detect log output → show speech bubble
        const prevLog = prevLogLineRef.current.get(agentId);
        if (agent.lastLogLine && agent.lastLogLine !== prevLog) {
          officeState.showSpeechBubble(agentId, agent.lastLogLine);
        }
        prevLogLineRef.current.set(agentId, agent.lastLogLine);
      }

      // Detect new team chat messages → show speech bubble on sender
      const prevTeamCount = prevTeamMsgCountRef.current;
      if (state.teamMessages.length > prevTeamCount) {
        for (let i = prevTeamCount; i < state.teamMessages.length; i++) {
          const tm = state.teamMessages[i];
          const toName = tm.toAgentName;
          const text = toName ? `${toName}: ${tm.message}` : tm.message;
          officeState.showSpeechBubble(tm.fromAgentId, text);
        }
      }
      prevTeamMsgCountRef.current = state.teamMessages.length;

      for (const agentId of knownAgentsRef.current) {
        if (!currentIds.has(agentId)) {
          officeState.removeCharacter(agentId);
          knownAgentsRef.current.delete(agentId);
          prevMsgCountRef.current.delete(agentId);
          prevLogLineRef.current.delete(agentId);
        }
      }
    });
    return unsub;
  }, [stateRef]);

  // Sync selection
  useEffect(() => {
    stateRef.current?.selectCharacter(selectedAgent);
  }, [selectedAgent, stateRef]);

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
      const layout = stateRef.current?.layout;
      if (layout) {
        const fAtTile = getFurnitureAtTile(layout, tile.col, tile.row);
        if (fAtTile && fAtTile.uid === editorRef.current.selectedFurnitureUid) {
          onDragStart?.(tile.col, tile.row);
        }
      }
    }
  }, [panRef, editorRef, stateRef, screenToTile, onDragStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const officeState = stateRef.current;

    // Update hover (non-edit mode)
    if (officeState && !editModeRef.current) {
      const world = screenToWorld(e.clientX, e.clientY);
      officeState.setHoveredCharAtPixel(world.x, world.y);
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
    if (editorRef.current.dragUid) return; // don't pan while dragging furniture

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panRef.current = {
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    };
  }, [screenToWorld, screenToTile, stateRef, panRef, editorRef, onDragMove, onGhostMove]);

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

    const officeState = stateRef.current;
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
  }, [screenToWorld, screenToTile, stateRef, editorRef, onTileClick, onDragEnd, onDeleteBtnClick, onRotateBtnClick]);

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
      }
    } else if (e.touches.length === 1 && isPanningRef.current) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      panRef.current = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
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
          const officeState = stateRef.current;
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
  }, [screenToWorld, screenToTile, stateRef, onTileClick]);

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
