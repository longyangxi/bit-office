"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOfficeStore, imageUploadCallbacks } from "@/store/office-store";
import { connect, disconnect, sendCommand } from "@/lib/connection";
import { getConnection } from "@/lib/storage";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { OfficeState } from "@/components/office/engine/officeState";
import { EditorState } from "@/components/office/editor/editorState";
import { EditTool } from "@/components/office/types";
import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX } from "@/components/office/constants";
import { useEditorActions } from "@/hooks/useEditorActions";
import { useEditorKeyboard } from "@/hooks/useEditorKeyboard";
import { useSoundEffects } from "@/hooks/useSoundEffects";

import type { SceneAdapter } from "@/components/office/scene/SceneAdapter";
import { useSceneBridge } from "@/components/office/scene/useSceneBridge";

// Extracted constants, theme, and utils
import { getStatusConfig, STATUS_CONFIG, BACKEND_OPTIONS } from "@/components/office/ui/office-constants";
import type { Ratings } from "@/components/office/ui/office-constants";
import { TERM_FONT, TERM_SIZE_3XS, TERM_SIZE_2XS, TERM_SIZE_XS, TERM_SIZE_SM, TERM_SIZE, TERM_SIZE_ICON, TERM_SIZE_LG, TERM_SIZE_XL, TERM_SIZE_2XL, TERM_THEMES, TERM_ACCENT, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_GLOW, TERM_BG, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_GLOW_BORDER, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_BLUE, TERM_SEM_PURPLE, TERM_SEM_CYAN, applyTermTheme } from "@/components/office/ui/termTheme";
import { isRealEnter, computePreviewUrl, hasWebPreview, buildPreviewCommand } from "@/components/office/ui/office-utils";
import { computeAutoGrid } from "@/components/office/ui/autoGrid";
import { APP_VERSION, APP_BUILD_TIME } from "@/lib/appMeta";

// Extracted components — regular imports for hooks and inline-rendered components
import { useConfirm } from "@/components/office/ui/ConfirmModal";
import { SysMsg, TokenBadge } from "@/components/office/ui/MessageBubble";

// Dynamic imports for extracted components
import dynamic from "next/dynamic";
const PixelOfficeScene = dynamic(() => import("@/components/office/scene/PixelOfficeScene"), { ssr: false });
const EditorToolbar = dynamic(() => import("@/components/office/editor/EditorToolbar"), { ssr: false });
const ZoomControls = dynamic(() => import("@/components/office/ui/ZoomControls"), { ssr: false });
const SettingsModal = dynamic(() => import("@/components/office/ui/SettingsModal"), { ssr: false });
const BottomToolbar = dynamic(() => import("@/components/office/ui/BottomToolbar"), { ssr: false });
const ProjectHistory = dynamic(() => import("@/components/office/ui/ProjectHistory"), { ssr: false });
const OfficeSwitcher = dynamic(() => import("@/components/office/ui/OfficeSwitcher"), { ssr: false });
const SpriteAvatar = dynamic(() => import("@/components/office/ui/SpriteAvatar"), { ssr: false });
const LoadingOverlay = dynamic(() => import("@/components/office/ui/LoadingOverlay"), { ssr: false });
const PreviewOverlay = dynamic(() => import("@/components/office/ui/PreviewOverlay"), { ssr: false });
const CelebrationModal = dynamic(() => import("@/components/office/ui/CelebrationModal"), { ssr: false });
const ConfettiOverlay = dynamic(() => import("@/components/office/ui/CelebrationModal").then(m => ({ default: m.ConfettiOverlay })), { ssr: false });
const MessageBubble = dynamic(() => import("@/components/office/ui/MessageBubble"), { ssr: false });
const TeamChatView = dynamic(() => import("@/components/office/ui/TeamChatView"), { ssr: false });
const TeamActivityToast = dynamic(() => import("@/components/office/ui/TeamActivityToast"), { ssr: false });
const TeamActivityLog = dynamic(() => import("@/components/office/ui/TeamActivityLog"), { ssr: false });
const CreateAgentModal = dynamic(() => import("@/components/office/ui/CreateAgentModal"), { ssr: false });
const HireModal = dynamic(() => import("@/components/office/ui/HireModal"), { ssr: false });
const HireTeamModal = dynamic(() => import("@/components/office/ui/HireTeamModal"), { ssr: false });
const AgentPane = dynamic(() => import("@/components/office/ui/AgentPane"), { ssr: false });
const MultiPaneView = dynamic(() => import("@/components/office/ui/MultiPaneView"), { ssr: false });
const CommandPalette = dynamic(() => import("@/components/office/ui/CommandPalette"), { ssr: false });
const ConsoleSidebar = dynamic(() => import("@/components/office/ui/ConsoleSidebar"), { ssr: false });
const UsagePanel = dynamic(() => import("@/components/office/ui/UsagePanel"), { ssr: false });
const MemoryPanel = dynamic(() => import("@/components/office/ui/MemoryPanel"), { ssr: false });
const DashboardPanel = dynamic(() => import("@/components/office/ui/DashboardPanel"), { ssr: false });
const NewProjectModal = dynamic(() => import("@/components/office/ui/NewProjectModal"), { ssr: false });
import TemplateSelector from "@/templates/TemplateSelector";
import type { ProjectTemplate } from "@/templates/templates";
const AblyLoader = dynamic(() => import("@/hooks/useAblyLoader"), { ssr: false });

/** Sentinel that triggers loadMore when scrolled into view */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) cbRef.current();
    }, { threshold: 0, rootMargin: "100px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ height: 1, flexShrink: 0 }} />;
}




// ---------------------------------------------------------------------------
// Demo script — simulates a team working session for GIF recording
// ---------------------------------------------------------------------------
function runDemoScript(onDone: () => void) {
  const store = useOfficeStore;
  const h = (event: Parameters<ReturnType<typeof useOfficeStore.getState>["handleEvent"]>[0]) =>
    store.getState().handleEvent(event);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  const LEADER = "demo-leader";
  const DEV = "demo-dev";
  const REVIEWER = "demo-reviewer";
  const TEAM = "demo-team";
  let ts = Date.now();
  const tick = () => ts++;

  const chat = (from: string, msg: string, type: "delegation" | "result" | "status" = "status", to?: string) =>
    h({ type: "TEAM_CHAT", fromAgentId: from, toAgentId: to, message: msg, messageType: type, timestamp: tick() });

  const log = (agentId: string, text: string) =>
    h({ type: "LOG_APPEND", agentId, taskId: "demo-task", stream: "stdout", chunk: text });

  // 0s — Create 3 agents
  h({ type: "AGENT_CREATED", agentId: LEADER, name: "Ash (Leader)", role: "Team Leader", teamId: TEAM, isTeamLead: true, palette: 0, isExternal: false });
  h({ type: "AGENT_CREATED", agentId: DEV, name: "Leo", role: "Developer", teamId: TEAM, palette: 1, isExternal: false });
  h({ type: "AGENT_CREATED", agentId: REVIEWER, name: "Mae", role: "Code Reviewer", teamId: TEAM, palette: 2, isExternal: false });

  // 0.5s — All agents sit at desks
  at(500, () => {
    h({ type: "AGENT_STATUS", agentId: LEADER, status: "working" });
    h({ type: "AGENT_STATUS", agentId: DEV, status: "working" });
    h({ type: "AGENT_STATUS", agentId: REVIEWER, status: "working" });
  });

  // 2s — Leader announces plan
  at(2000, () => chat(LEADER, "Alright team! Let's build a space shooter game with PixiJS."));

  // 5s — Leader delegates to dev
  at(5000, () => chat(LEADER, "Build the complete game — player controls, enemies, scoring, and sound effects.", "delegation", DEV));

  // 8s — Leader delegates to reviewer
  at(8000, () => chat(LEADER, "Stand by to review Leo's code when he's done.", "delegation", REVIEWER));

  // 11s — Dev progress
  at(11000, () => log(DEV, "Setting up project structure"));

  // 14s — Dev progress
  at(14000, () => log(DEV, "Building player ship and controls"));

  // 17s — Dev progress
  at(17000, () => log(DEV, "Adding enemy waves and collision"));

  // 20s — Dev progress
  at(20000, () => log(DEV, "Implementing score system and UI"));

  // 23s — Dev finishes
  at(23000, () => {
    log(DEV, "Build passed. All files verified.");
    chat(DEV, "Space shooter complete — 5 enemy types, power-ups, and high score system.", "result");
  });

  // 26s — Reviewer starts
  at(26000, () => log(REVIEWER, "Checking file structure"));

  // 29s — Reviewer progress
  at(29000, () => log(REVIEWER, "Reading game logic and collision detection"));

  // 32s — Reviewer passes
  at(32000, () => chat(REVIEWER, "VERDICT: PASS — Clean code, smooth gameplay loop, all features working.", "result"));

  // 35s — Leader wraps up
  at(35000, () => chat(LEADER, "Great work everyone! The space shooter is ready to ship.", "result"));

  // 39s — Cleanup
  at(39000, () => {
    h({ type: "AGENT_FIRED", agentId: LEADER });
    h({ type: "AGENT_FIRED", agentId: DEV });
    h({ type: "AGENT_FIRED", agentId: REVIEWER });
    // Clear team messages
    store.setState({ teamMessages: [] });
    onDone();
  });
}

// Temporary reviewer agents — auto-fired when they finish
const tempReviewerIds = new Set<string>();
// Synchronous guard: source agents with an active review (prevents stale-closure double-clicks)
const activeReviewSources = new Set<string>();

// Per-agent working directory map (persists across renders, not in state to avoid re-renders)
const agentWorkDirMap = new Map<string, string>();

export default function OfficePage() {
  const router = useRouter();
  // Reactive state — re-render when these change
  const agents = useOfficeStore(s => s.agents);
  const connected = useOfficeStore(s => s.connected);
  const teamMessages = useOfficeStore(s => s.teamMessages);
  const teamPhases = useOfficeStore(s => s.teamPhases);
  const agentDefs = useOfficeStore(s => s.agentDefs);
  const role = useOfficeStore(s => s.role);
  const suggestions = useOfficeStore(s => s.suggestions);
  const detectedBackends = useOfficeStore(s => s.detectedBackends);
  const agentLogLines = useOfficeStore(s => s.agentLogLines);
  const projects = useOfficeStore(s => s.projects);
  const activeProjectId = useOfficeStore(s => s.activeProjectId);
  // Subscribe so component re-renders when loadMoreMessages() updates the count
  const visibleMessageCount = useOfficeStore(s => s.visibleMessageCount); // eslint-disable-line @typescript-eslint/no-unused-vars

  // Stable refs — these functions never change identity, no need to trigger re-renders
  const { addUserMessage, clearTeamMessages, setRole, getVisibleMessages, loadMoreMessages, addAgentToProject, getActiveProject, setPendingTemplatePrompt, consumeTemplatePrompt } = useOfficeStore.getState();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRatings, setPreviewRatings] = useState<Ratings>({});
  const [previewRated, setPreviewRated] = useState(false);
  const [celebration, setCelebration] = useState<{ previewUrl?: string; previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const { confirm, modal: confirmModal } = useConfirm();
  const [showHireModal, setShowHireModal] = useState(false);
  const [showHireTeamModal, setShowHireTeamModal] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectBlank, setNewProjectBlank] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTeamOpen, setMobileTeamOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<{ name: string; dataUrl: string; base64: string }[]>([]);
  const pasteMapRef = useRef(new Map<string, string>()); // label → full text (shared: single-pane mode)
  /** Pending template auto-submit: { agentId, prompt } — set after hire, consumed when agent appears idle */
  const pendingTemplateRunRef = useRef<{ agentId: string; prompt: string } | null>(null);
  const panePasteMapRef = useRef(new Map<string, Map<string, string>>()); // agentId → (label → full text)
  const pasteCountRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Editor state
  const [editMode, setEditMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [memoryAgentId, setMemoryAgentId] = useState<string | null>(null);
  const [showOfficeSwitcher, setShowOfficeSwitcher] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [currentOfficeId, setCurrentOfficeId] = useState<string | null>(null);
  const [showEditorControls, setShowEditorControls] = useState(false);
  const [testActive, setTestActive] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [showDemoButton, setShowDemoButton] = useState(false);
  const showTestButton = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test');
  useEffect(() => {
    setShowDemoButton(new URLSearchParams(window.location.search).has('demo'));
  }, []);
  const [mapAspect, setMapAspect] = useState(1); // cols/rows ratio for scene width
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [consoleCols, setConsoleCols] = useState(3);
  const [consoleRows, setConsoleRows] = useState(1);
  const [autoGridEnabled, setAutoGridEnabled] = useState(true);
  const [, forceUpdate] = useState(0);
  const editorRef = useRef(new EditorState());
  const officeStateRef = useRef<OfficeState | null>(null);
  const [sceneAdapter, setSceneAdapter] = useState<SceneAdapter | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [assetsReady, setAssetsReady] = useState(false);

  // ── Theme ──
  // Always start with default to avoid SSR/client hydration mismatch,
  // then restore saved theme in useEffect (client-only).
  const [termTheme, setTermTheme] = useState("studio");
  applyTermTheme(termTheme);
  useEffect(() => {
    const saved = localStorage.getItem("open-office-theme");
    if (saved && TERM_THEMES[saved]) {
      setTermTheme(saved);
    }
  }, []);
  useEffect(() => {
    applyTermTheme(termTheme);
    localStorage.setItem("open-office-theme", termTheme);
  }, [termTheme]);

  // ── Cmd+K command palette ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Bridge store → scene adapter
  useSceneBridge(sceneAdapter, selectedAgent);

  // Gateway may override preview URL (e.g. auto-detected Vite dev server)
  const pendingPreviewUrl = useOfficeStore(s => s.pendingPreviewUrl);
  useEffect(() => {
    if (pendingPreviewUrl && previewUrl) {
      setPreviewUrl(pendingPreviewUrl);
      useOfficeStore.getState().consumePreviewUrl();
    }
  }, [pendingPreviewUrl, previewUrl]);

  // Load sound + grid preferences
  useEffect(() => {
    try {
      const stored = localStorage.getItem('office-sound-enabled');
      if (stored !== null) setSoundEnabled(JSON.parse(stored));
    } catch { /* ignore */ }
    try {
      const c = localStorage.getItem('office-console-cols');
      const r = localStorage.getItem('office-console-rows');
      if (c !== null) setConsoleCols(Math.max(1, Math.min(6, JSON.parse(c))));
      if (r !== null) setConsoleRows(Math.max(1, Math.min(4, JSON.parse(r))));
    } catch { /* ignore */ }
  }, []);

  // Play sound effects on store events (task start/done/error/approval/delegation)
  useSoundEffects(soundEnabled);

  // Tauri: listen for drag-drop events to capture folder/file paths AND images
  // (Tauri intercepts native drop events, so web onDrop doesn't fire in desktop mode)
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
    Promise.all([
      // @ts-ignore — only available in Tauri context
      import("@tauri-apps/api/webview"),
      // @ts-ignore
      import("@tauri-apps/api/core"),
    ]).then(([{ getCurrentWebview }, { convertFileSrc }]) => {
      getCurrentWebview().onDragDropEvent((event: any) => {
        if (event.payload.type !== "drop" || !event.payload.paths?.length) return;
        const paths: string[] = event.payload.paths;
        const imagePaths = paths.filter((p: string) => IMAGE_EXT.test(p));
        const otherPaths = paths.filter((p: string) => !IMAGE_EXT.test(p));

        // Handle images: read via asset protocol → blob → File → addImageFromFile
        for (const imgPath of imagePaths) {
          const url = convertFileSrc(imgPath);
          fetch(url)
            .then(r => r.blob())
            .then(blob => {
              const name = imgPath.split("/").pop() || "image.png";
              const file = new File([blob], name, { type: blob.type || "image/png" });
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(",")[1];
                const ext = name.split(".").pop() || "png";
                const label = `image-${Date.now()}.${ext}`;
                setPendingImages(prev => [...prev, { name: label, dataUrl, base64 }]);
              };
              reader.readAsDataURL(file);
            })
            .catch(() => {});
        }

        // Handle folders/other files: insert path into prompt
        if (otherPaths.length > 0) {
          setPrompt(prev => {
            const insert = otherPaths.join(" ");
            return prev ? prev + " " + insert : insert;
          });
        }
      }).then((fn: () => void) => { unlisten = fn; });
    }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Celebrate task completion:
  // - Solo agent (no teamId, not leader): status === "done"
  // - Team leader: message has isFinalResult === true (set by orchestrator when no pending delegations)
  const hydrated = useOfficeStore(s => s.hydrated);
  const seenCelebrationIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    // First run: seed all existing result message IDs as seen
    if (seenCelebrationIdsRef.current === null) {
      const seen = new Set<string>();
      for (const [, agentState] of agents) {
        for (const msg of agentState.messages) {
          if (msg.result || msg.isFinalResult) seen.add(msg.id);
        }
      }
      seenCelebrationIdsRef.current = seen;
      return;
    }
    // Only check the last message of each agent — new results always append at the end.
    // Assumption: TASK_DONE handler always appends the result as the final message.
    // If two results arrive in the same React render batch, only the last is detected.
    // This is acceptable because Zustand state updates are synchronous per event.
    for (const [, agentState] of agents) {
      const msgs = agentState.messages;
      if (msgs.length === 0) continue;
      const msg = msgs[msgs.length - 1];
      if (!msg.result) continue;
      if (seenCelebrationIdsRef.current.has(msg.id)) continue;
      seenCelebrationIdsRef.current.add(msg.id);
      // Only celebrate when actual work was done (code changes, tests, or preview)
      const r = msg.result;
      if (r.changedFiles.length === 0 && r.testResult === "unknown" && !r.previewUrl && !r.previewCmd && !r.previewPath) continue;
      // Team member → never celebrate
      if (agentState.teamId && !agentState.isTeamLead) continue;
      // Team leader → only celebrate when isFinalResult is explicitly true
      if (agentState.isTeamLead && !msg.isFinalResult) continue;
      // Solo agent or leader with isFinalResult → celebrate
      const celebData = { previewUrl: r.previewUrl, previewPath: r.previewPath, previewCmd: r.previewCmd, previewPort: r.previewPort, projectDir: r.projectDir, entryFile: r.entryFile };
      // Only show modal if there's something to preview/launch
      const canPreview = hasWebPreview({ previewUrl: r.previewUrl, previewCmd: r.previewCmd, previewPort: r.previewPort, previewPath: r.previewPath, entryFile: r.entryFile });
      const canLaunch = !canPreview && buildPreviewCommand({ previewPath: r.previewPath, previewCmd: r.previewCmd, previewPort: r.previewPort, projectDir: r.projectDir, entryFile: r.entryFile });
      if (canPreview || canLaunch) {
        setCelebration(celebData);
        setPreviewRatings({});
        setPreviewRated(false);
      }
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    }
  }, [hydrated, agents]);

  const onLayoutChange = useCallback(() => {
    forceUpdate((n) => n + 1);
  }, []);

  const {
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
    handleSelectedFurnitureColorChange,
  } = useEditorActions(editorRef, officeStateRef, onLayoutChange);

  /** Fit zoom for a given layout — renderer already centers the map, so just reset pan */
  const fitZoomToLayout = useCallback((layout: import('@/components/office/types').OfficeLayout) => {
    const canvas = document.querySelector('canvas');
    if (!canvas?.parentElement) return;
    const viewW = canvas.parentElement.clientWidth;
    const viewH = canvas.parentElement.clientHeight;
    const mapW = layout.cols * TILE_SIZE;
    const mapH = layout.rows * TILE_SIZE;
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(viewW / mapW, viewH / mapH, ZOOM_MAX));
    panRef.current = { x: 0, y: 0 };
  }, [zoomRef, panRef]);

  const handleImportRoomZip = useCallback((layout: import('@/components/office/types').OfficeLayout, backgroundImage: HTMLImageElement | null) => {
    const office = officeStateRef.current;
    if (!office) return;
    office.setBackgroundImage(backgroundImage);
    handleImportLayout(layout);
    setMapAspect(layout.cols / layout.rows);
    // Recalc zoom after React re-render + container resize settles
    requestAnimationFrame(() => requestAnimationFrame(() => fitZoomToLayout(layout)));
  }, [officeStateRef, handleImportLayout, fitZoomToLayout]);

  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      if (!next) {
        editorRef.current.reset();
      }
      return next;
    });
  }, []);

  useEditorKeyboard({
    editMode,
    editorRef,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDeleteSelected: handleDeleteSelected,
    onRotateSelected: handleRotateSelected,
    onExitEditMode: toggleEditMode,
  });

  // Load office zip on mount (always from /offices/)
  const handleAssetsLoaded = useCallback(async () => {
    const office = officeStateRef.current;
    if (office) {
      try {
        const { loadDefaultOffice } = await import("@/components/office/ui/OfficeSwitcher");
        const result = await loadDefaultOffice();
        if (result) {
          office.setBackgroundImage(result.backgroundImage);
          handleImportLayout(result.layout);
          setCurrentOfficeId(result.officeId);
          setMapAspect(result.layout.cols / result.layout.rows);
          // Recalc zoom after React re-render + container resize settles
          requestAnimationFrame(() => requestAnimationFrame(() => fitZoomToLayout(result.layout)));
        }
      } catch (err) {
        console.warn('[OfficePage] Failed to load default office zip:', err);
      }
    }
    setAssetsReady(true);
  }, []);

  const handleAdapterReady = useCallback((adapter: SceneAdapter) => {
    setSceneAdapter(adapter);
  }, []);

  useEffect(() => {
    const conn = getConnection();
    if (!conn || !conn.sessionToken) {
      if (conn && !conn.sessionToken) {
        const { clearConnection } = require("@/lib/storage");
        clearConnection();
      }
      router.push("/pair");
      return;
    }

    // Cancelled flag — prevents stale async connect after StrictMode unmount.
    // Without this, React StrictMode's double-mount creates two WS connections
    // that briefly coexist, causing broadcast events to be received twice.
    let cancelled = false;

    // Re-detect gateway port instead of using stale stored wsUrl
    const detectAndConnect = async () => {
      setRole(conn.role ?? "owner");
      useOfficeStore.getState().hydrate();

      // If mode is ably, use stored info as-is
      if (conn.mode === "ably") {
        if (cancelled) return;
        return connect(conn);
      }

      const isTauri = !!(window as any).__TAURI_INTERNALS__;
      const isDev = window.location.port === "3000" || window.location.port === "3002";

      // Tauri production: pair page already resolved the sidecar port via IPC.
      // Use the saved connection directly — port scanning would hit the wrong gateway
      // if a web dev server is also running.
      if (isTauri && !isDev && conn.wsUrl) {
        if (cancelled) return;
        return connect(conn);
      }

      // For ws mode: detect live gateway port
      const ports = isDev ? [9099, 9090, 9091] : [9090, 9091, 9099];

      // Try same-origin first (production bundled mode)
      if (!isDev) {
        try {
          const res = await fetch(`${window.location.origin}/connect`, { signal: AbortSignal.timeout(500) });
          if (cancelled) return;
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            const freshConn = { ...conn, wsUrl: window.location.origin.replace(/^http/, "ws"), sessionToken: data.sessionToken };
            const { saveConnection } = await import("@/lib/storage");
            if (cancelled) return;
            saveConnection(freshConn);
            return connect(freshConn);
          }
        } catch { /* not bundled mode */ }
      }

      // Scan preferred ports — only accept gateways matching saved gatewayId
      for (const port of ports) {
        if (cancelled) return;
        try {
          const res = await fetch(`http://localhost:${port}/connect`, { signal: AbortSignal.timeout(1000) });
          if (cancelled) return;
          if (!res.ok) continue;
          const data = await res.json();
          if (cancelled) return;
          // Skip gateways with mismatched gatewayId to avoid cross-instance connection
          if (conn.gatewayId && data.gatewayId && data.gatewayId !== conn.gatewayId) continue;
          const freshConn = { ...conn, wsUrl: `ws://localhost:${port}`, sessionToken: data.sessionToken, gatewayId: data.gatewayId };
          const { saveConnection } = await import("@/lib/storage");
          if (cancelled) return;
          saveConnection(freshConn);
          return connect(freshConn);
        } catch { /* try next */ }
      }

      // Fallback to stored wsUrl
      if (cancelled) return;
      return connect(conn);
    };

    let scopedDisconnect: (() => void) | undefined;
    detectAndConnect().then((d) => { scopedDisconnect = d; });
    // On cleanup: mark cancelled so in-flight async aborts, then tear down
    // any connection that was already established (covers sync Ably/Tauri paths
    // where scopedDisconnect may not be captured yet by the .then()).
    return () => { cancelled = true; scopedDisconnect?.(); disconnect(); };
  }, [router, setRole]);

  const selectedAgentState = selectedAgent ? agents.get(selectedAgent) : null;
  const isAgentBusy = selectedAgentState?.status === "working" || selectedAgentState?.status === "waiting_approval";
  const selectedMsgCount = selectedAgentState?.messages.length ?? 0;
  const wasAtBottomRef = useRef(true);
  const resizingRef = useRef(false);

  // When prompt clears (user submitted), force next auto-scroll
  const prevPromptRef = useRef(prompt);
  useEffect(() => {
    if (prevPromptRef.current && !prompt) {
      wasAtBottomRef.current = true;
    }
    prevPromptRef.current = prompt;
  }, [prompt]);

  // Track scroll position via scroll events (skip during resize to avoid false negatives)
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const onScroll = () => {
      if (resizingRef.current) return;
      wasAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [selectedAgent]);

  // Keep scroll pinned to bottom when container resizes (e.g. textarea grow/shrink, layout change)
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      resizingRef.current = true;
      if (wasAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      requestAnimationFrame(() => { resizingRef.current = false; });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [selectedAgent]);

  // Scroll to bottom synchronously after DOM commit when messages change.
  // useLayoutEffect runs before paint and before scroll events, so wasAtBottomRef
  // still reflects the state BEFORE new content increased scrollHeight.
  useLayoutEffect(() => {
    const el = chatEndRef.current;
    const container = el?.parentElement;
    if (container && wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [selectedAgent, selectedMsgCount]);

  // MutationObserver for streaming text / typewriter reveals within existing messages.
  // Uses wasAtBottomRef (set by scroll events BEFORE content changed) instead of
  // measuring current distance, so large chunks that push distance > 80px still scroll.
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (wasAtBottomRef.current) {
            container.scrollTop = container.scrollHeight;
          }
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [selectedAgent]);

  // Auto-select team lead when a team is first created
  useEffect(() => {
    if (selectedAgent) return;
    const lead = Array.from(agents.values()).find(a => a.isTeamLead);
    if (lead) {
      setSelectedAgent(lead.agentId);
      setChatOpen(true);
    }
  }, [agents, selectedAgent]);

  const handleAgentClick = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
    setChatOpen(true);
  }, []);

  const handleHire = useCallback((def: AgentDefinition, backend: string, workDir?: string, displayName?: string) => {
    const AUTO_NAMES = [
      "Alex", "Mia", "Leo", "Nova", "Luna", "Rex", "Kai", "Zoe", "Jay", "Sam",
      "Ava", "Max", "Ivy", "Nix", "Eli", "Rio", "Sky", "Ada", "Fin", "Eve",
      "Ash", "Ren", "Kit", "Juno", "Sage", "Aria", "Cole", "Tess", "Hugo", "Nell",
    ];
    const name = displayName?.trim() || (() => {
      const usedNames = new Set(Array.from(agents.values()).map(a => a.name.toLowerCase()));
      const available = AUTO_NAMES.find(n => !usedNames.has(n.toLowerCase()));
      return available ?? `Agent${usedNames.size + 1}`;
    })();
    const agentId = `agent-${nanoid(6)}`;
    sendCommand({ type: "CREATE_AGENT", agentId, name, role: def.skills ? `${def.role} — ${def.skills}` : def.role, palette: def.palette, personality: def.personality, backend, workDir, skillFiles: def.skillFiles, canDelegate: def.canDelegate, noCode: def.noCode });
    // Store workDir locally so RUN_TASK can pass it as repoPath
    if (workDir) {
      agentWorkDirMap.set(agentId, workDir);
    }
    // Auto-associate agent with active project
    const proj = getActiveProject();
    if (proj) addAgentToProject(proj.id, agentId);
    setSelectedAgent(agentId);
    setChatOpen(true);
    setShowHireModal(false);
    // If a template was selected, queue auto-submit for when this agent becomes idle
    const tpl = consumeTemplatePrompt();
    if (tpl) pendingTemplateRunRef.current = { agentId, prompt: tpl };
  }, [agents]); // addAgentToProject, getActiveProject are stable refs from getState()

  const handleCreateTeam = useCallback((leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string) => {
    const proj = getActiveProject();
    if (proj) {
      useOfficeStore.setState({ pendingTeamProjectId: proj.id });
    }
    sendCommand({ type: "CREATE_TEAM", leadId, memberIds, backends, workDir });
    setShowHireTeamModal(false);
    setSelectedAgent(null);
    setChatOpen(false);
    setMobileTeamOpen(true);
    // If a template was selected, queue auto-submit for team lead (agentId "" = find lead)
    const tpl = consumeTemplatePrompt();
    if (tpl) pendingTemplateRunRef.current = { agentId: "", prompt: tpl };
  }, []);

  // Shared handler for project creation (used by both inline empty-state and modal)
  const handleProjectCreated = useCallback((projectId: string, mode: string, template?: ProjectTemplate) => {
    setShowNewProjectModal(false);
    if (template?.suggestedPrompt) {
      const seniorDev = agentDefs.find(d => d.id === "senior-dev")
        ?? agentDefs.find(d => d.isBuiltin && d.teamRole === "dev");
      if (seniorDev) {
        const backend = detectedBackends.length > 0 ? detectedBackends[0] : "claude";
        setPendingTemplatePrompt(template.suggestedPrompt);
        handleHire(seniorDev, backend);
        return;
      }
    }
    if (mode === "solo") setShowHireModal(true);
    else if (mode === "team") setShowHireTeamModal(true);
  }, [agentDefs, detectedBackends, setPendingTemplatePrompt, handleHire]);

  // Inline template click: create project + dispatch through shared handler
  const handleInlineTemplateSelect = useCallback((t: ProjectTemplate | null) => {
    if (t) {
      const { createProject } = useOfficeStore.getState();
      const projectId = createProject(t.name, "");
      handleProjectCreated(projectId, "solo", t);
    } else {
      // Open modal directly in blank form mode
      setNewProjectBlank(true);
      setShowNewProjectModal(true);
    }
  }, [handleProjectCreated]);

  const handleSaveAgentDef = useCallback((def: AgentDefinition) => {
    sendCommand({ type: "SAVE_AGENT_DEF", agent: def });
    setShowCreateAgent(false);
    setEditingAgent(null);
    setShowHireModal(true);
  }, []);

  const handleDeleteAgentDef = useCallback((agentDefId: string) => {
    sendCommand({ type: "DELETE_AGENT_DEF", agentDefId });
  }, []);

  const handleFire = useCallback(async (agentId: string) => {
    const agent = agents.get(agentId);
    if (!await confirm(`Fire ${agent?.name ?? agentId}?`)) return;
    sendCommand({ type: "FIRE_AGENT", agentId });
    if (selectedAgent === agentId) {
      setSelectedAgent(null);
      setChatOpen(false);
    }
  }, [selectedAgent, agents, confirm]);

  const hasTeam = useMemo(() => {
    for (const a of agents.values()) {
      if (a.teamId) return true;
    }
    return false;
  }, [agents]);

  const teamBusy = Array.from(agents.values()).some(
    (a) => !!a.teamId && (a.status === "working" || a.status === "waiting_approval"),
  );

  const handleStopTeam = useCallback(() => {
    sendCommand({ type: "STOP_TEAM" });
    const teamAgents = Array.from(agents.values()).filter((a) => !!a.teamId);
    for (const a of teamAgents) {
      sendCommand({ type: "CANCEL_TASK", agentId: a.agentId, taskId: "" });
    }
  }, [agents]);



  const addImageFromFile = useCallback((file: File, agentId?: string) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const ext = file.name.split(".").pop() || "png";
      const name = `image-${nanoid(6)}.${ext}`;
      const img = { name, dataUrl, base64 };
      if (agentId) {
        setPanePendingImages((prev) => {
          const m = new Map(prev);
          m.set(agentId, [...(m.get(agentId) || []), img]);
          return m;
        });
      } else {
        setPendingImages((prev) => [...prev, img]);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Single-agent paste (non-console mode)
  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
        return;
      }
    }
  }, [addImageFromFile]);

  // Multi-pane paste (console mode) — receives agentId from MultiPaneView
  const handlePanePasteImage = useCallback((agentId: string, e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file, agentId);
        return;
      }
    }
  }, [addImageFromFile]);

  const handlePasteText = useCallback((e: React.ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      const lines = text.split("\n");
      if (lines.length > 3 || text.length > 200) {
        e.preventDefault();
        pasteCountRef.current++;
        const info = lines.length > 1 ? `+${lines.length} lines` : `${text.length} chars`;
        const label = `[Pasted text #${pasteCountRef.current} ${info}]`;
        pasteMapRef.current.set(label, text);
        const input = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
        const pos = input.selectionStart ?? prompt.length;
        setPrompt(prev => prev.slice(0, pos) + label + prev.slice(pos));
      }
    }
  }, [prompt]);

  const [panePrompts, setPanePrompts] = useState<Map<string, string>>(new Map());

  // Multi-pane text paste — updates per-pane prompt instead of shared prompt
  // Uses per-agent paste map so clearing one agent's data doesn't affect others
  const handlePanePasteText = useCallback((agentId: string, e: React.ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      const lines = text.split("\n");
      if (lines.length > 3 || text.length > 200) {
        e.preventDefault();
        pasteCountRef.current++;
        const info = lines.length > 1 ? `+${lines.length} lines` : `${text.length} chars`;
        const label = `[Pasted text #${pasteCountRef.current} ${info}]`;
        // Store in per-agent map (isolated from other agents)
        if (!panePasteMapRef.current.has(agentId)) {
          panePasteMapRef.current.set(agentId, new Map());
        }
        panePasteMapRef.current.get(agentId)!.set(label, text);
        const input = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
        const curPrompt = panePrompts.get(agentId) || "";
        const pos = input.selectionStart ?? curPrompt.length;
        setPanePrompts(prev => {
          const m = new Map(prev);
          m.set(agentId, curPrompt.slice(0, pos) + label + curPrompt.slice(pos));
          return m;
        });
      }
    }
  }, [panePrompts]);

  const handleDropImage = useCallback((e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  // Multi-pane drop
  const handlePaneDropImage = useCallback((agentId: string, e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        addImageFromFile(file, agentId);
      }
    }
  }, [addImageFromFile]);

  /** Upload pending images to gateway and return file paths */
  const uploadImages = useCallback(async (images: { name: string; dataUrl: string; base64: string }[]): Promise<string[]> => {
    if (images.length === 0) return [];
    const uploads = images.map((img) => {
      return new Promise<string>((resolve) => {
        const rid = nanoid(6);
        imageUploadCallbacks.set(rid, resolve);
        sendCommand({ type: "UPLOAD_IMAGE", requestId: rid, data: img.base64, filename: img.name });
        setTimeout(() => { imageUploadCallbacks.delete(rid); resolve(""); }, 5000);
      });
    });
    const paths = await Promise.all(uploads);
    return paths.filter((p) => !!p);
  }, []);

  const handleRunTask = useCallback(async () => {
    if (!selectedAgent || (!prompt.trim() && pendingImages.length === 0)) return;
    const agent = agents.get(selectedAgent);
    if (!agent) return;

    // Upload images first, collect paths
    const imagePaths = await uploadImages(pendingImages);

    // Expand pasted text labels back to full content
    let finalPrompt = prompt.trim();
    for (const [label, fullText] of pasteMapRef.current) {
      finalPrompt = finalPrompt.replace(label, fullText);
    }
    if (imagePaths.length > 0) {
      finalPrompt += (finalPrompt ? "\n\n" : "") + imagePaths.map((p) => `[Attached image: ${p}]`).join("\n");
    }
    finalPrompt = finalPrompt.trim();

    const taskId = nanoid();
    const displayText = finalPrompt;
    addUserMessage(selectedAgent, taskId, displayText);
    const repoPath = agentWorkDirMap.get(selectedAgent);
    sendCommand({
      type: "RUN_TASK",
      agentId: selectedAgent,
      taskId,
      prompt: finalPrompt,
      repoPath,
      name: agent?.name,
      role: agent?.role,
      personality: agent?.personality,
    });
    setPrompt("");
    setPendingImages([]);
    // Only clear shared paste map — per-agent maps are untouched
    pasteMapRef.current.clear();
  }, [selectedAgent, prompt, pendingImages, addUserMessage, agents, uploadImages]);

  const handleCancel = useCallback(() => {
    if (!selectedAgent) return;
    sendCommand({ type: "CANCEL_TASK", agentId: selectedAgent, taskId: "" });
  }, [selectedAgent]);

  // ── Auto-submit template prompt when agent becomes idle ──
  // pendingTemplateRunRef is set by handleHire/handleCreateTeam. This effect watches
  // the agents map for the target agent to appear as idle, then auto-sends the task.
  // For teams, agentId="" means "find the team lead".
  useEffect(() => {
    const pending = pendingTemplateRunRef.current;
    if (!pending) return;
    // Resolve target agent
    let targetId = pending.agentId;
    if (!targetId) {
      // Team mode — find the team lead
      const lead = Array.from(agents.values()).find(a => a.isTeamLead);
      if (!lead) return; // lead not created yet
      targetId = lead.agentId;
    }
    const agent = agents.get(targetId);
    if (!agent || agent.status !== "idle") return;
    // Agent is ready — fire the template prompt
    pendingTemplateRunRef.current = null;
    const taskId = nanoid();
    addUserMessage(targetId, taskId, pending.prompt);
    sendCommand({
      type: "RUN_TASK",
      agentId: targetId,
      taskId,
      prompt: pending.prompt,
      repoPath: agentWorkDirMap.get(targetId),
      name: agent.name,
      role: agent.role,
      personality: agent.personality,
    });
  }, [agents]);

  // Get the current team phase for the selected agent (if it's a team lead)
  const getAgentPhase = useCallback((agentId: string): string | null => {
    for (const [, tp] of teamPhases) {
      if (tp.leadAgentId === agentId) return tp.phase;
    }
    return null;
  }, [teamPhases]);

  const selectedAgentPhase = selectedAgent ? getAgentPhase(selectedAgent) : null;

  // Note: [PLAN] detection is handled by the gateway, which transitions to "design" phase.
  // The frontend just checks the phase to decide whether to show the Approve button.

  const handleApprovePlan = useCallback(() => {
    if (!selectedAgent) return;
    sendCommand({ type: "APPROVE_PLAN", agentId: selectedAgent });
  }, [selectedAgent]);

  const handleEndProject = useCallback(() => {
    if (!selectedAgent) return;
    const agentState = agents.get(selectedAgent);
    sendCommand({
      type: "END_PROJECT",
      agentId: selectedAgent,
      name: agentState?.name,
      role: agentState?.role,
      personality: agentState?.personality,
      backend: agentState?.backend,
    });
    clearTeamMessages();
  }, [selectedAgent, agents, clearTeamMessages]);

  const handleApproval = useCallback((approvalId: string, decision: "yes" | "no") => {
    sendCommand({ type: "APPROVAL_DECISION", approvalId, decision });
  }, []);

  // Zoom controls
  const handleZoomChange = useCallback((newZoom: number) => {
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    forceUpdate((n) => n + 1);
  }, []);

  const agentList = Array.from(agents.values());
  const editor = editorRef.current;

  // Responsive: detect mobile + track viewport width for auto-grid
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1400); // SSR-safe default
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    setViewportWidth(window.innerWidth);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => { mq.removeEventListener("change", handler); window.removeEventListener("resize", onResize); };
  }, []);

  const isOwner = role === "owner";
  const isCollaborator = role === "collaborator";
  const isSpectator = role === "spectator";
  const [suggestText, setSuggestText] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleSuggest = useCallback(() => {
    if (!suggestText.trim()) return;
    sendCommand({ type: "SUGGEST", text: suggestText.trim() });
    setSuggestText("");
  }, [suggestText]);

  const [showShareMenu, setShowShareMenu] = useState(false);
  // Phase 2: Console mode is now default. Persisted to localStorage.
  const [consoleMode, setConsoleMode] = useState(true); // SSR-safe default; restored from localStorage in useEffect
  // Freeze scroll during CSS width transition (300ms) to prevent scroll corruption
  const [scrollFrozen, setScrollFrozen] = useState(false);
  // Multi-pane state (console mode only)
  const [openPanes, setOpenPanes] = useState<string[]>([]);
  const [paneOffset, setPaneOffset] = useState(0);
  type ImageItem = { name: string; dataUrl: string; base64: string };
  const [panePendingImages, setPanePendingImages] = useState<Map<string, ImageItem[]>>(new Map());
  const [sceneVisible, setSceneVisible] = useState(false); // SSR-safe default; restored from localStorage in useEffect

  // Restore view mode from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    const saved = localStorage.getItem("office-view-mode");
    if (saved === "office") {
      setConsoleMode(false);
      setSceneVisible(true);
    }
  }, []);

  // Review overlays: keyed by sourceAgentId — multiple solo agents can have concurrent reviews
  const [reviewOverlays, setReviewOverlays] = useState<Map<string, { reviewerAgentId: string; sourceAgentId: string }>>(new Map());
  // When review is done, store the result text per source agent for user confirmation
  const [reviewResultTexts, setReviewResultTexts] = useState<Map<string, string>>(new Map());

  // Show agents belonging to the active project, or all solo agents if no project
  const activeProject = activeProjectId ? projects.get(activeProjectId) : undefined;
  const allAgents = activeProject
    ? agentList.filter(a => activeProject.agentIds.includes(a.agentId) && !a.agentId.startsWith("reviewer-"))
    : agentList.filter(a => !a.teamId && !a.agentId.startsWith("reviewer-"));
  const activeAgentIds = allAgents.map(a => a.agentId).filter(id => !tempReviewerIds.has(id)).join(",");
  // Sync open panes whenever agent list changes — preserve custom drag order (persisted)
  useEffect(() => {
    if (!consoleMode) return;
    const ids = activeAgentIds ? activeAgentIds.split(",") : [];
    setOpenPanes(prev => {
      // On first load (prev empty), restore saved order from localStorage
      let base = prev;
      if (base.length === 0) {
        try {
          const saved = localStorage.getItem("office-pane-order");
          if (saved) base = JSON.parse(saved) as string[];
        } catch {}
      }
      const activeSet = new Set(ids);
      const kept = base.filter(id => activeSet.has(id));
      const keptSet = new Set(kept);
      const added = ids.filter(id => !keptSet.has(id));
      const merged = [...kept, ...added];
      if (merged.length === prev.length && merged.every((id, i) => id === prev[i])) return prev;
      return merged;
    });
  }, [consoleMode, activeAgentIds]);
  // Reset page offset on entering console mode
  useEffect(() => {
    if (!consoleMode) return;
    setPaneOffset(0);
  }, [consoleMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-click review: spin up a temporary Code Reviewer as overlay on source agent
  // Supports concurrent reviews — each source agent can have one active review
  const handleReview = useCallback((sourceAgentId: string, result: { changedFiles: string[]; projectDir?: string; entryFile?: string; summary: string }, backend?: string) => {
    // Synchronous dedup guard (immune to stale React closures on rapid clicks)
    if (activeReviewSources.has(sourceAgentId)) return;
    activeReviewSources.add(sourceAgentId);
    const sourceAgent = agents.get(sourceAgentId);
    const reviewerAgentId = `reviewer-${nanoid(6)}`;
    tempReviewerIds.add(reviewerAgentId);
    // Set overlay immediately — reviewer pane appears on top of source agent
    setReviewOverlays(prev => new Map(prev).set(sourceAgentId, { reviewerAgentId, sourceAgentId }));
    // Gateway handles everything: git diff, reviewer creation, prompt construction, task run
    sendCommand({
      type: "REQUEST_REVIEW",
      reviewerAgentId,
      sourceAgentId,
      changedFiles: result.changedFiles,
      projectDir: result.projectDir,
      entryFile: result.entryFile,
      summary: result.summary,
      backend: backend ?? sourceAgent?.backend ?? "claude",
    });
  }, [agents]);

  // When any reviewer finishes, extract review text and wait for user confirmation
  useEffect(() => {
    if (reviewOverlays.size === 0) return;
    let updated = false;
    const nextTexts = new Map(reviewResultTexts);
    for (const [sourceId, overlay] of reviewOverlays) {
      if (nextTexts.has(sourceId)) continue; // already captured
      const reviewer = agents.get(overlay.reviewerAgentId);
      if (!reviewer) continue;
      const isTerminal = reviewer.status === "done" || reviewer.status === "idle" || reviewer.status === "error";
      if (!isTerminal) continue;
      const reviewMessages = reviewer.messages.filter(m => m.role === "agent" && m.text);
      if (reviewer.status === "error" && reviewMessages.length === 0) {
        const sysError = reviewer.messages.filter(m => m.role === "system" && m.text).map(m => m.text).join("\n");
        nextTexts.set(sourceId, sysError || "(Review failed — reviewer encountered an error)");
        updated = true;
      } else if (reviewMessages.length > 0) {
        nextTexts.set(sourceId, reviewMessages[reviewMessages.length - 1].text || "(No issues found)");
        updated = true;
      }
    }
    if (updated) setReviewResultTexts(nextTexts);
  }, [agents, reviewOverlays, reviewResultTexts]);

  // User actions on review completion — per source agent
  const handleApplyReviewFixes = useCallback((sourceAgentId: string, userFeedback?: string) => {
    const overlay = reviewOverlays.get(sourceAgentId);
    if (!overlay) return;
    const { reviewerAgentId } = overlay;
    const reviewer = agents.get(reviewerAgentId);
    const resolvedText = reviewResultTexts.get(sourceAgentId)
      ?? (reviewer?.messages.filter(m => m.role === "agent" && m.text).map(m => m.text).join("\n\n") || null);
    if (!resolvedText) return;
    const sourceAgent = agents.get(sourceAgentId);
    const cwd = sourceAgent?.cwd ?? sourceAgent?.workDir ?? "";
    const fixTaskId = `fix-${nanoid(6)}`;
    const extractStructured = (text: string): string => {
      const verdictMatch = text.match(/\*{0,2}VERDICT[\s:].*/i);
      if (verdictMatch) {
        const startIdx = text.indexOf(verdictMatch[0]);
        return text.slice(startIdx).trim();
      }
      const issuesMatch = text.match(/\*{0,2}ISSUES[\s:].*/i);
      if (issuesMatch) {
        const startIdx = text.indexOf(issuesMatch[0]);
        return text.slice(startIdx).trim();
      }
      return text.length > 1000 ? text.slice(-1000).trim() : text;
    };
    const structuredFeedback = extractStructured(resolvedText);
    const fixPromptParts = [
      `A code review found issues. Fix ONLY CRITICAL items (bugs, crashes, security).`,
      `IGNORE SUGGESTION items. Make minimum changes — do NOT rewrite or restructure.`,
    ];
    if (userFeedback) {
      fixPromptParts.push(``, `User instructions: ${userFeedback}`);
    }
    fixPromptParts.push(``, `Review findings:`, structuredFeedback);
    const fixPrompt = fixPromptParts.join("\n");
    addUserMessage(sourceAgentId, fixTaskId, userFeedback ? `[Review] ${userFeedback}` : `[Review] Apply critical fixes`);
    sendCommand({ type: "RUN_TASK", agentId: sourceAgentId, taskId: fixTaskId, prompt: fixPrompt, repoPath: cwd || undefined });
    // Cleanup this review
    sendCommand({ type: "FIRE_AGENT", agentId: reviewerAgentId });
    tempReviewerIds.delete(reviewerAgentId);
    activeReviewSources.delete(sourceAgentId);
    setReviewOverlays(prev => { const next = new Map(prev); next.delete(sourceAgentId); return next; });
    setReviewResultTexts(prev => { const next = new Map(prev); next.delete(sourceAgentId); return next; });
  }, [reviewOverlays, reviewResultTexts, agents, addUserMessage]);

  const handleDismissReview = useCallback((sourceAgentId: string) => {
    const overlay = reviewOverlays.get(sourceAgentId);
    if (!overlay) return;
    const { reviewerAgentId } = overlay;
    sendCommand({ type: "FIRE_AGENT", agentId: reviewerAgentId });
    tempReviewerIds.delete(reviewerAgentId);
    activeReviewSources.delete(sourceAgentId);
    setReviewOverlays(prev => { const next = new Map(prev); next.delete(sourceAgentId); return next; });
    setReviewResultTexts(prev => { const next = new Map(prev); next.delete(sourceAgentId); return next; });
  }, [reviewOverlays]);

  // Auto-dismiss stuck reviews: if reviewer agent never appears within 30s, clear overlay
  useEffect(() => {
    if (reviewOverlays.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [sourceId, overlay] of reviewOverlays) {
      const reviewer = agents.get(overlay.reviewerAgentId);
      if (reviewer) continue; // reviewer exists, not stuck
      timers.push(setTimeout(() => {
        // Re-check: if reviewer still doesn't exist, clean up
        sendCommand({ type: "FIRE_AGENT", agentId: overlay.reviewerAgentId });
        tempReviewerIds.delete(overlay.reviewerAgentId);
        activeReviewSources.delete(sourceId);
        setReviewOverlays(prev => { const next = new Map(prev); next.delete(sourceId); return next; });
      }, 30_000));
    }
    return () => timers.forEach(t => clearTimeout(t));
  }, [agents, reviewOverlays]);

  // Fallback: auto-fire orphaned temp reviewers (non-overlay, e.g. if overlay was cleared manually)
  useEffect(() => {
    if (tempReviewerIds.size === 0) return;
    const activeReviewerIds = new Set([...reviewOverlays.values()].map(o => o.reviewerAgentId));
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const rid of tempReviewerIds) {
      if (activeReviewerIds.has(rid)) continue; // handled by overlay effect above
      const ag = agents.get(rid);
      if (ag && (ag.status === "done" || ag.status === "idle" || ag.status === "error") && ag.messages.length > 1) {
        timers.push(setTimeout(() => {
          sendCommand({ type: "FIRE_AGENT", agentId: rid });
          tempReviewerIds.delete(rid);
        }, 120_000));
      }
    }
    if (timers.length === 0) return;
    return () => timers.forEach(t => clearTimeout(t));
  }, [agents, reviewOverlays]);

  // Helper to get reviewer overlay data for rendering — looks up result text per source agent
  const getReviewerData = useCallback((sourceAgentId: string) => {
    const overlay = reviewOverlays.get(sourceAgentId);
    if (!overlay) return null;
    const ag = agents.get(overlay.reviewerAgentId);
    if (!ag) return null;
    const visible = getVisibleMessages(overlay.reviewerAgentId);
    const resultText = reviewResultTexts.get(sourceAgentId) ?? null;
    return {
      agentId: overlay.reviewerAgentId,
      name: ag.name,
      role: ag.role,
      backend: ag.backend,
      status: ag.status,
      messages: ag.messages,
      visibleMessages: visible,
      hasMoreMessages: visible.length < ag.messages.length,
      tokenUsage: ag.tokenUsage,
      lastLogLine: agentLogLines.get(ag.agentId) ?? ag.lastLogLine ?? null,
      busy: resultText === null,
      reviewDone: resultText !== null,
      reviewResultText: resultText ?? undefined,
      verdict: resultText ? (resultText.match(/\*{0,2}VERDICT:?\*{0,2}\s*(PASS|FAIL)/i)?.[1]?.toUpperCase() as "PASS" | "FAIL" ?? "UNKNOWN") : undefined,
    };
  }, [agents, getVisibleMessages, reviewOverlays, reviewResultTexts]);

  // Reset pagination and scroll when console mode toggles
  const prevConsoleModeRef = useRef(consoleMode);
  useEffect(() => {
    if (prevConsoleModeRef.current === consoleMode) return;
    prevConsoleModeRef.current = consoleMode;
    if (consoleMode) setPaneOffset(0);
    const timer = setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
      wasAtBottomRef.current = true;
    }, 350);
    return () => clearTimeout(timer);
  }, [consoleMode]);

  const handleCreateShareLink = useCallback(async (shareRole: "collaborator" | "spectator") => {
    try {
      const { getGatewayHttpUrl } = await import("@/lib/storage");
      const baseUrl = getGatewayHttpUrl();
      // Share creation uses the pair code. We prompt the user to enter it.
      const code = window.prompt("Enter your pair code to create a share link:");
      if (!code) return;
      const res = await fetch(`${baseUrl}/share/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), role: shareRole }),
      });
      if (res.ok) {
        const data = await res.json();
        const url = `${window.location.origin}/join?token=${data.token}&gateway=${encodeURIComponent(baseUrl)}`;
        setShareUrl(url);
        navigator.clipboard?.writeText(url).catch(() => {});
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to create share link");
      }
    } catch (err) {
      console.error("[Share] Failed to create share link:", err);
    }
    setShowShareMenu(false);
  }, []);

  const isChatExpanded = chatOpen && selectedAgent !== null;

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative", overflow: "hidden", display: "flex", backgroundColor: TERM_BG }}>
      <AblyLoader />
      {/* Game Scene — fills remaining space after sidebar, centered */}
      {sceneVisible && !consoleMode && <div style={{ flex: 1, position: "relative", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginRight: "calc(min(40vw, 800px) + 30px)" }}>
        {/* Loading overlay — fades out to reveal scene */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 5,
          backgroundColor: TERM_BG,
          animation: "scene-overlay-fadeout 2s ease-out 0.1s forwards",
          pointerEvents: "none",
        }} />
        <div style={{ width: `min(100%, calc(100vh * ${mapAspect}))`, height: `min(100%, calc(100vw / ${mapAspect}))`, aspectRatio: `${mapAspect}`, position: "relative", maxHeight: "100vh" }}>
        <PixelOfficeScene
          onAdapterReady={handleAdapterReady}
          onAgentClick={handleAgentClick}
          editMode={editMode}
          editorRef={editorRef}
          officeStateRef={officeStateRef}
          zoomRef={zoomRef}
          panRef={panRef}
          onTileClick={handleTileClick}
          onTileRightClick={handleRightClick}
          onGhostMove={updateGhost}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDeleteBtnClick={handleDeleteSelected}
          onRotateBtnClick={handleRotateSelected}
          onAssetsLoaded={handleAssetsLoaded}
        />

        {/* Loading overlay — covers canvas until office ZIP is loaded */}
        <LoadingOverlay visible={!assetsReady} />

        {/* Top-left status bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
          background: "linear-gradient(to bottom, var(--term-bg) 0%, transparent 100%)",
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
            <h1 className="px-font" style={{ fontSize: TERM_SIZE_SM, margin: 0, color: TERM_ACCENT, textShadow: "2px 2px 0px rgba(0,0,0,0.8), 0 0 12px rgba(200,155,48,0.3)", letterSpacing: "0.05em" }}>Open Office</h1>
            <span
              title={APP_BUILD_TIME ? `Web UI v${APP_VERSION}\nBuild ${APP_BUILD_TIME}` : `Web UI v${APP_VERSION}`}
              style={{
                fontSize: TERM_SIZE_3XS,
                color: "rgba(232, 220, 184, 0.4)",
                fontFamily: "monospace",
                letterSpacing: "0.04em",
                userSelect: "text",
              }}
            >v{APP_VERSION}</span>
            <span style={{
              fontSize: TERM_SIZE_2XS, padding: "3px 7px",
              border: `1px solid ${connected ? `${TERM_SEM_GREEN}40` : `${TERM_SEM_RED}40`}`,
              backgroundColor: connected ? `${TERM_SEM_GREEN}15` : `${TERM_SEM_RED}15`,
              color: connected ? TERM_SEM_GREEN : TERM_SEM_RED,
              fontFamily: "monospace", letterSpacing: "0.05em",
            }}>
              {connected ? "● ONLINE" : "● OFFLINE"}
            </span>
            {editMode && (
              <span style={{
                fontSize: TERM_SIZE_2XS, padding: "3px 7px",
                border: "1px solid #5a3a10",
                backgroundColor: "#1a0e00", color: "#e8b040",
                fontFamily: "monospace",
              }}>
                EDIT MODE
              </span>
            )}
            {isSpectator && (
              <span style={{
                fontSize: TERM_SIZE_2XS, padding: "3px 7px",
                border: "1px solid #3b82f6",
                backgroundColor: "#1a2744", color: "#7ab8f5",
                fontFamily: "monospace", letterSpacing: "0.05em",
              }}>
                WATCHING
              </span>
            )}
            {isCollaborator && (
              <span style={{
                fontSize: TERM_SIZE_2XS, padding: "3px 7px",
                border: "1px solid #a855f7",
                backgroundColor: "#2d1a44", color: TERM_SEM_PURPLE,
                fontFamily: "monospace", letterSpacing: "0.05em",
              }}>
                COLLABORATOR
              </span>
            )}
            {isOwner && (
              <div style={{ position: "relative" }}>
                <span
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  style={{
                    fontSize: TERM_SIZE_2XS, padding: "3px 7px", cursor: "pointer",
                    border: "1px solid #a855f760",
                    backgroundColor: showShareMenu ? "#a855f720" : "transparent", color: TERM_SEM_PURPLE,
                    fontFamily: "monospace", letterSpacing: "0.05em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#a855f720"; }}
                  onMouseLeave={(e) => { if (!showShareMenu) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  SHARE
                </span>
                {showShareMenu && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
                    backgroundColor: TERM_PANEL, border: `1px solid ${TERM_BORDER}`,
                    display: "flex", flexDirection: "column", minWidth: 160,
                  }}>
                    <button
                      onClick={() => handleCreateShareLink("collaborator")}
                      style={{
                        padding: "8px 12px", border: "none", backgroundColor: "transparent",
                        color: TERM_SEM_PURPLE, fontSize: TERM_SIZE_SM, cursor: "pointer", textAlign: "left",
                        fontFamily: "monospace",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#a855f720"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >Collaborator link</button>
                    <button
                      onClick={() => handleCreateShareLink("spectator")}
                      style={{
                        padding: "8px 12px", border: "none", backgroundColor: "transparent",
                        color: TERM_SEM_BLUE, fontSize: TERM_SIZE_SM, cursor: "pointer", textAlign: "left",
                        fontFamily: "monospace",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#3b82f620"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >Spectator link</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Editor Toolbar */}
        {editMode && (
          <EditorToolbar
            activeTool={editor.activeTool}
            selectedTileType={editor.selectedTileType}
            selectedFurnitureType={editor.selectedFurnitureType}
            selectedFurnitureUid={editor.selectedFurnitureUid}
            selectedFurnitureColor={(() => {
              if (!editor.selectedFurnitureUid || !officeStateRef.current) return null;
              const item = officeStateRef.current.layout.furniture.find((f) => f.uid === editor.selectedFurnitureUid);
              return item?.color ?? null;
            })()}
            floorColor={editor.floorColor}
            wallColor={editor.wallColor}
            onToolChange={(tool) => {
              editor.activeTool = tool as typeof editor.activeTool;
              editor.clearSelection();
              forceUpdate((n) => n + 1);
            }}
            onTileTypeChange={(type) => { editor.selectedTileType = type; forceUpdate((n) => n + 1); }}
            onFloorColorChange={(color) => { editor.floorColor = color; forceUpdate((n) => n + 1); }}
            onWallColorChange={(color) => { editor.wallColor = color; forceUpdate((n) => n + 1); }}
            onSelectedFurnitureColorChange={handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={(type) => { editor.selectedFurnitureType = type; editor.activeTool = EditTool.FURNITURE_PLACE; forceUpdate((n) => n + 1); }}
          />
        )}

        {/* Bottom Toolbar (desktop only) */}
        {!isMobile && (
          <BottomToolbar
            editMode={editMode}
            onToggleEditMode={toggleEditMode}
            onOpenOfficeSwitcher={() => setShowOfficeSwitcher(true)}
            showEditorControls={showEditorControls}
            testActive={testActive}
            onToggleTest={showTestButton ? () => {
              const office = officeStateRef.current;
              if (!office) return;
              if (office.hasTestCharacters()) {
                office.clearTestCharacters();
                setTestActive(false);
              } else {
                office.spawnTestCharacters();
                setTestActive(true);
              }
            } : undefined}
          />
        )}

        {/* Team activity toast notifications */}
        {teamMessages.length > 0 && (
          <TeamActivityToast messages={teamMessages} agents={agents} assetsReady={assetsReady} />
        )}

        </div>
      </div>}

      {/* ── Right Sidebar (desktop only) — takes remaining space after game scene ── */}
      {!isMobile && <>

        <div className={`term-dotgrid${scrollFrozen ? " console-transitioning" : ""}`} style={{
          position: "fixed",
          right: 0,
          top: 0,
          width: consoleMode ? "100vw" : "min(40vw, 800px)",
          minWidth: 260,
          height: "100vh",
          backgroundColor: TERM_PANEL,
          border: "none",
          borderLeft: "none",
          boxShadow: consoleMode ? "none" : `-4px 0 12px -2px rgba(0,0,0,0.5), -1px 0 0 rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.04)`,
          display: "flex",
          flexDirection: "row",
          overflow: "visible",
          transition: "width 0.3s ease",
          willChange: "width",
          zIndex: 10,
        }}>

          {/* ── Console mode: left sidebar ── */}
          {consoleMode && (
            <ConsoleSidebar
              onNewProject={() => setShowNewProjectModal(true)}
              onOpenHistory={() => setShowHistory(true)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenUsage={() => setShowUsage(true)}
              onOpenMemory={() => setShowMemory(true)}
              onOpenDashboard={() => setShowDashboard(true)}
              onBackToOffice={() => {
                setScrollFrozen(true);
                setConsoleMode(false);
                localStorage.setItem("office-view-mode", "office");
                setTimeout(() => { setSceneVisible(true); setScrollFrozen(false); }, 350);
              }}
              onCloseProject={async (projectId: string) => {
                const proj = projects.get(projectId);
                if (!proj) return;
                if (!await confirm(`Close project "${proj.name}"?\nThis will fire all agents and archive the project.`)) return;
                const hasTeamAgents = proj.agentIds.some((id: string) => agents.get(id)?.teamId);
                if (hasTeamAgents) {
                  sendCommand({ type: "FIRE_TEAM" });
                  clearTeamMessages();
                }
                for (const agentId of proj.agentIds) {
                  if (agents.has(agentId)) {
                    sendCommand({ type: "FIRE_AGENT", agentId });
                  }
                }
                useOfficeStore.getState().archiveProject(projectId);
              }}
              onHireToProject={(projectId: string) => {
                useOfficeStore.getState().setActiveProject(projectId);
                setShowHireModal(true);
              }}
            />
          )}

          {/* ── Office mode: arrow + theme picker — absolutely positioned to the left of sidebar ── */}
          {!consoleMode && (
          <div style={{
            position: "absolute",
            right: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            transition: "opacity 0.15s ease",
            opacity: sceneVisible ? 1 : 0,
            pointerEvents: sceneVisible ? "auto" : "none",
          }}>
          {/* Arrow button — switch to console mode */}
          <button
            onClick={() => {
              setScrollFrozen(true);
              setSceneVisible(false);
              localStorage.setItem("office-view-mode", "console");
              requestAnimationFrame(() => setConsoleMode(true));
              setTimeout(() => setScrollFrozen(false), 350);
            }}
            style={{
              width: 28, height: 40, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0,
              background: TERM_PANEL + "80",
              borderRadius: "10px 0 0 10px",
              borderTop: `1px solid ${TERM_ACCENT}40`,
              borderBottom: `1px solid ${TERM_ACCENT}40`,
              borderLeft: `1px solid ${TERM_ACCENT}40`,
              borderRight: "none",
              boxShadow: "-2px 0 8px rgba(0,0,0,0.3)",
              color: TERM_ACCENT, fontSize: TERM_SIZE,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = TERM_SURFACE; e.currentTarget.style.color = TERM_ACCENT; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = TERM_PANEL + "80"; e.currentTarget.style.color = TERM_ACCENT; }}
            title="Console Mode"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Theme picker */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, alignItems: "center" }}>
            {Object.entries(TERM_THEMES).filter(([key]) => !["gruvbox", "nord", "dracula", "slate", "black-metal", "owl", "vague", "iceberg-dark", "office", "catppuccin", "everforest"].includes(key)).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => setTermTheme(key)}
                title={theme.name}
                style={{
                  width: 10, height: 10, borderRadius: "50%", padding: 0,
                  border: termTheme === key ? `2px solid ${theme.accent}` : "1px solid #444",
                  backgroundColor: theme.accent,
                  cursor: "pointer",
                  opacity: termTheme === key ? 1 : 0.4,
                  transition: "all 0.15s",
                  boxShadow: termTheme === key ? `0 0 6px ${theme.accent}60` : "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { if (termTheme !== key) e.currentTarget.style.opacity = "0.4"; }}
              />
            ))}
          </div>
          </div>
          )}
          {/* ── Main content area ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {(() => {
            const unsortedAgentList = allAgents.filter(a => !tempReviewerIds.has(a.agentId));
            const paneOrder = new Map(openPanes.map((id, i) => [id, i]));
            const activeAgentList = [...unsortedAgentList].sort((a, b) => {
              const ai = paneOrder.get(a.agentId) ?? Infinity;
              const bi = paneOrder.get(b.agentId) ?? Infinity;
              return ai - bi;
            });

            const selectedInTab = activeAgentList.some((a) => a.agentId === selectedAgent);

            // Shared inline template selector for empty state (no active project, no agents)
            const inlineTemplateSelector = !activeProjectId && activeAgentList.length === 0 && connected ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ maxWidth: 480, width: "100%", padding: "var(--space-4)" }}>
                  <div style={{ marginBottom: "var(--space-4)", textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: TERM_SIZE_XL, fontWeight: 700, color: "var(--term-accent)", letterSpacing: "0.04em" }}>
                      Start a Project
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: TERM_SIZE_2XS, color: "var(--term-dim)", marginTop: "var(--space-1)" }}>
                      pick a template or start blank
                    </div>
                  </div>
                  <TemplateSelector selected={null} onSelect={handleInlineTemplateSelect} />
                </div>
              </div>
            ) : null;

            return (<>

            {/* -- Project Bar (office sidebar mode only, projects are in console sidebar) -- */}

            {/* -- Horizontal Agent Bar (hidden in console mode — avatars shown inline on each pane) -- */}
            {!consoleMode && (
            <div
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
              onMouseDown={(e) => {
                // Drag-to-scroll: only on the bar background, not on agent buttons
                if ((e.target as HTMLElement).closest("button")) return;
                const el = e.currentTarget;
                const startX = e.clientX;
                const startScroll = el.scrollLeft;
                el.style.cursor = "grabbing";
                el.style.userSelect = "none";
                const onMove = (ev: MouseEvent) => {
                  el.scrollLeft = startScroll - (ev.clientX - startX);
                };
                const onUp = () => {
                  el.style.cursor = "";
                  el.style.userSelect = "";
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
              style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", minHeight: 64,
              borderBottom: `1px solid ${TERM_BORDER_DIM}`,
              background: TERM_PANEL,
              overflowX: "auto", overflowY: "hidden",
              scrollbarWidth: "none",
              cursor: "grab",
            }}>
              {activeAgentList.map((agent, idx) => {
                const isActive = selectedAgent === agent.agentId;
                const agentState = agents.get(agent.agentId);
                const statusKey = agentState?.status ?? agent.status ?? "idle";
                const cfg = getStatusConfig()[statusKey] ?? getStatusConfig().idle;
                const agentBusy = statusKey === "working";
                const isWaiting = statusKey === "waiting_approval";
                const isError = statusKey === "error";
                const isDone = statusKey === "done";
                const isLead = !!agentState?.isTeamLead;
                // Ring color based on status
                const ringColor = agentBusy ? TERM_ACCENT
                  : isWaiting ? TERM_SEM_YELLOW
                  : isError ? TERM_SEM_RED
                  : isDone ? TERM_SEM_GREEN
                  : TERM_BORDER;
                return (
                  <button
                    key={agent.agentId}
                    className="agent-tab"
                    data-active={isActive}
                    onClick={() => { setSelectedAgent(agent.agentId); setChatOpen(true); }}
                    title={`${agent.name} - ${cfg.label}`}
                  >
                    {/* Avatar with status ring */}
                    <div style={{
                      position: "relative", width: 34, height: 40,
                      overflow: "hidden", borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${ringColor}`,
                      boxShadow: agentBusy ? `0 0 6px ${TERM_ACCENT}30` : isWaiting ? `0 0 6px ${TERM_SEM_YELLOW}25` : "none",
                      transition: "border-color 0.3s ease, box-shadow 0.3s ease",
                    }}>
                      <div style={{ marginTop: -1, marginLeft: 1 }}>
                        <SpriteAvatar palette={agent.palette ?? 0} zoom={2} ready={assetsReady} />
                      </div>
                      {agentBusy && (
                        <span style={{
                          position: "absolute", top: 2, right: 2,
                          width: 6, height: 6, borderRadius: "50%",
                          backgroundColor: TERM_ACCENT,
                          boxShadow: `0 0 4px ${TERM_ACCENT}`,
                          animation: "px-pulse-gold 1.5s ease infinite",
                        }} />
                      )}
                    </div>
                    {/* Name + Role + Status */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{
                          fontSize: TERM_SIZE_XS, fontWeight: 600,
                          color: isActive ? TERM_TEXT_BRIGHT : TERM_TEXT,
                          fontFamily: TERM_FONT, maxWidth: 80,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          letterSpacing: "-0.01em",
                        }}>{agent.name}</span>
                        {isLead && (
                          <span style={{
                            fontSize: TERM_SIZE_3XS, fontFamily: TERM_FONT,
                            color: TERM_SEM_YELLOW, fontWeight: 700,
                            padding: "0 3px", lineHeight: "14px",
                            border: `1px solid ${TERM_SEM_YELLOW}40`,
                            borderRadius: 3, flexShrink: 0,
                          }}>LEAD</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        {(agentState?.backend || agent.backend) && (
                          <span style={{
                            fontSize: TERM_SIZE_3XS, color: TERM_DIM,
                            fontFamily: TERM_FONT, maxWidth: 70,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{BACKEND_OPTIONS.find((b) => b.id === (agentState?.backend || agent.backend))?.name ?? (agentState?.backend || agent.backend)}</span>
                        )}
                        <span style={{
                          width: 5, height: 5, borderRadius: "50%",
                          backgroundColor: cfg.color, flexShrink: 0,
                          boxShadow: agentBusy ? `0 0 4px ${cfg.color}80` : "none",
                        }} />
                      </div>
                    </div>
                  </button>
                );
              })}
              {/* Hire "+" button — same size as agent cell (routes to New Project when no active project) */}
              {isOwner && (
                <button
                  className="agent-tab-hire"
                  onClick={() => activeProjectId ? setShowHireModal(true) : setShowNewProjectModal(true)}
                  title={activeProjectId ? "Hire Agent" : "New Project"}
                >+</button>
              )}
              {/* Team: hire when no team, stop/fire when team exists */}
              {isOwner && !hasTeam && (
                <button onClick={() => setShowHireTeamModal(true)} title="Hire Team"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 5, padding: "6px 16px", height: 52, flexShrink: 0,
                    border: `1px solid ${TERM_ACCENT}50`, cursor: "pointer",
                    backgroundColor: `${TERM_ACCENT}12`, color: `${TERM_ACCENT}cc`,
                    fontSize: TERM_SIZE_XS, fontFamily: TERM_FONT, fontWeight: 500,
                    borderRadius: 6, transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_ACCENT}25`; e.currentTarget.style.borderColor = `${TERM_ACCENT}90`; e.currentTarget.style.color = TERM_ACCENT; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_ACCENT}12`; e.currentTarget.style.borderColor = `${TERM_ACCENT}50`; e.currentTarget.style.color = `${TERM_ACCENT}cc`; }}
                ><span style={{ fontSize: TERM_SIZE_ICON, lineHeight: 1 }}>+</span> hire team</button>
              )}
              {isOwner && hasTeam && teamBusy && (
                <button onClick={handleStopTeam} title="Stop Team Work"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, padding: "6px 14px", height: 52,
                    border: `1px solid ${TERM_SEM_YELLOW}60`, cursor: "pointer",
                    backgroundColor: `${TERM_SEM_YELLOW}10`, color: TERM_SEM_YELLOW,
                    fontSize: TERM_SIZE_2XS, fontFamily: TERM_FONT,
                    borderRadius: 6, transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}20`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${TERM_SEM_YELLOW}10`; }}
                >stop</button>
              )}
            </div>
            )}

            {/* -- Chat content: single pane (sidebar) or multi pane (console) -- */}
            {/* Auto-select first agent if none selected in current tab (sidebar mode only) */}
            {!consoleMode && !selectedInTab && activeAgentList.length > 0 && (() => {
              const first = activeAgentList[0];
              setTimeout(() => { setSelectedAgent(first.agentId); setChatOpen(true); }, 0);
              return null;
            })()}
            {consoleMode ? (
              inlineTemplateSelector || <MultiPaneView
                openPanes={openPanes.filter(id => activeAgentList.some(a => a.agentId === id))}
                getAgentData={(agentId) => {
                  const ag = agents.get(agentId);
                  if (!ag) return null;
                  const visible = getVisibleMessages(agentId);
                  return {
                    agentId, name: ag.name, role: ag.role, backend: ag.backend,
                    status: ag.status, cwd: ag.cwd, workDir: ag.workDir,
                    messages: ag.messages, visibleMessages: visible,
                    hasMoreMessages: visible.length < ag.messages.length,
                    tokenUsage: ag.tokenUsage, isTeamLead: ag.isTeamLead,
                    isTeamMember: !!ag.teamId && !ag.isTeamLead,
                    isExternal: false, teamId: ag.teamId,
                    teamPhase: ag.isTeamLead ? getAgentPhase(agentId) : null,
                    pendingApproval: ag.pendingApproval ?? null,
                    awaitingApproval: ag.awaitingApproval,
                    lastLogLine: agentLogLines.get(ag.agentId) ?? ag.lastLogLine ?? null,
                    busy: ag.status === "working" || ag.status === "waiting_approval",
                    pid: ag.pid,
                    autoMerge: ag.autoMerge,
                    pendingMerge: ag.pendingMerge,
                    lastMergeCommit: ag.lastMergeCommit,
                    lastMergeMessage: ag.lastMergeMessage,
                    undoCount: ag.undoCount,
                  };
                }}
                paneOffset={paneOffset}
                onPaneOffsetChange={setPaneOffset}
                panePrompts={panePrompts}
                onPanePromptChange={(agentId, val) => setPanePrompts(prev => { const m = new Map(prev); m.set(agentId, val); return m; })}
                isOwner={isOwner}
                isCollaborator={isCollaborator}
                isSpectator={isSpectator}
                panePendingImages={panePendingImages}
                onPanePendingImagesChange={(agentId, imgs) => setPanePendingImages(prev => { const m = new Map(prev); m.set(agentId, imgs); return m; })}
                suggestions={suggestions}
                suggestText={suggestText}
                onSuggestTextChange={setSuggestText}
                onSubmit={async (agentId) => {
                  const p = panePrompts.get(agentId)?.trim() || "";
                  const paneImages = panePendingImages.get(agentId) || [];
                  if (!p && paneImages.length === 0) return;
                  const ag = agents.get(agentId);
                  if (!ag) return;

                  // Upload images first, collect paths
                  const imagePaths = await uploadImages(paneImages);

                  // Expand pasted text labels back to full content
                  // Try per-agent paste map first, then fall back to shared map
                  let finalPrompt = p;
                  const agentPasteMap = panePasteMapRef.current.get(agentId);
                  if (agentPasteMap) {
                    for (const [label, fullText] of agentPasteMap) {
                      finalPrompt = finalPrompt.replace(label, fullText);
                    }
                  }
                  // Also check shared map (backward compat: paste done in single-pane, submit in multi-pane)
                  for (const [label, fullText] of pasteMapRef.current) {
                    finalPrompt = finalPrompt.replace(label, fullText);
                  }
                  if (imagePaths.length > 0) {
                    finalPrompt += (finalPrompt ? "\n\n" : "") + imagePaths.map((ip) => `[Attached image: ${ip}]`).join("\n");
                  }
                  finalPrompt = finalPrompt.trim();
                  if (!finalPrompt) return;

                  const taskId = 'task-' + Date.now().toString(36);
                  addUserMessage(agentId, taskId, finalPrompt);
                  sendCommand({ type: "RUN_TASK", agentId, taskId, prompt: finalPrompt, repoPath: agentWorkDirMap.get(agentId) });
                  setPanePrompts(prev => { const m = new Map(prev); m.set(agentId, ''); return m; });
                  setPanePendingImages(prev => { const m = new Map(prev); m.delete(agentId); return m; });
                  // Only clear this agent's paste data, not everyone's
                  panePasteMapRef.current.delete(agentId);
                }}
                onCancel={(agentId) => sendCommand({ type: "CANCEL_TASK", agentId, taskId: "" })}
                onFire={handleFire}
                onApproval={handleApproval}
                onApprovePlan={(agentId) => sendCommand({ type: "APPROVE_PLAN", agentId })}
                onQuickApprove={(agentId) => {
                  const ag = agents.get(agentId);
                  if (!ag) return;
                  const taskId = 'task-' + Date.now().toString(36);
                  addUserMessage(agentId, taskId, "yes");
                  sendCommand({ type: "RUN_TASK", agentId, taskId, prompt: "yes", repoPath: agentWorkDirMap.get(agentId) });
                }}
                onEndProject={(agentId) => {
                  const ag = agents.get(agentId);
                  sendCommand({ type: "END_PROJECT", agentId, name: ag?.name, role: ag?.role, personality: ag?.personality, backend: ag?.backend });
                  clearTeamMessages();
                }}
                onSuggest={handleSuggest}
                onPreview={setPreviewUrl}
                onReview={(agentId, result, backend) => handleReview(agentId, result, backend)}
                detectedBackends={detectedBackends}
                onLoadMore={(agentId) => loadMoreMessages(agentId)}
                onPasteImage={handlePanePasteImage}
                onPasteText={handlePanePasteText}
                onDropImage={handlePaneDropImage}
                reviewOverlays={reviewOverlays}
                getReviewerData={getReviewerData}
                onReviewerLoadMore={(agentId) => loadMoreMessages(agentId)}
                onApplyReviewFixes={handleApplyReviewFixes}
                onDismissReview={handleDismissReview}
                onMerge={(agentId) => sendCommand({ type: "MERGE_WORKTREE", agentId })}
                onRevert={(agentId) => sendCommand({ type: "REVERT_WORKTREE", agentId })}
                onUndoMerge={async (agentId) => {
                  const ag = agents.get(agentId);
                  const hash = ag?.lastMergeCommit?.slice(0, 7) ?? "???";
                  const msg = ag?.lastMergeMessage || "merge commit";
                  if (await confirm(`Undo merge ${hash}?\n"${msg}"\n\nThis will remove the merge commit from main.`)) {
                    sendCommand({ type: "UNDO_MERGE", agentId });
                  }
                }}
                scrollFrozen={scrollFrozen}
                onReorderPanes={(order: string[]) => {
                  setOpenPanes(order);
                  try { localStorage.setItem("office-pane-order", JSON.stringify(order)); } catch {}
                }}
                agentMeta={activeAgentList.map(a => ({ agentId: a.agentId, name: a.name, palette: a.palette ?? 0, isTeamLead: !!agents.get(a.agentId)?.isTeamLead }))}
                assetsReady={assetsReady}
                showHireButton={isOwner}
                hireLabel={!activeProjectId ? "new project" : "hire"}
                onHire={() => {
                  if (!activeProjectId) { setShowNewProjectModal(true); return; }
                  setShowHireModal(true);
                }}
                showTeamControls={isOwner && hasTeam}
                teamBusy={teamBusy}
                onStopTeam={handleStopTeam}
                cols={autoGridEnabled ? computeAutoGrid(openPanes.filter(id => activeAgentList.some(a => a.agentId === id)).length, viewportWidth).cols : consoleCols}
                rows={autoGridEnabled ? computeAutoGrid(openPanes.filter(id => activeAgentList.some(a => a.agentId === id)).length, viewportWidth).rows : consoleRows}
              />
            ) : selectedAgent && selectedInTab ? (() => {
              const ag = agents.get(selectedAgent);
              if (!ag) return null;
              const visible = getVisibleMessages(selectedAgent);
              const isTeamMember = !!ag.teamId && !ag.isTeamLead;
              const busy = ag.status === "working" || ag.status === "waiting_approval";
              return (
                <AgentPane
                  key={selectedAgent}
                  agentId={selectedAgent}
                  name={ag.name}
                  role={ag.role}
                  backend={ag.backend}
                  status={ag.status}
                  cwd={ag.cwd}
                  workDir={ag.workDir}
                  messages={ag.messages}
                  visibleMessages={visible}
                  hasMoreMessages={visible.length < ag.messages.length}
                  tokenUsage={ag.tokenUsage}
                  isTeamLead={ag.isTeamLead}
                  isTeamMember={isTeamMember}
                  isExternal={false}
                  teamId={ag.teamId}
                  teamPhase={ag.isTeamLead ? getAgentPhase(selectedAgent) : null}
                  pendingApproval={ag.pendingApproval ?? null}
                  awaitingApproval={ag.awaitingApproval}
                  lastLogLine={agentLogLines.get(ag.agentId) ?? ag.lastLogLine ?? null}
                  busy={busy}
                  pid={ag.pid}
                  isOwner={isOwner}
                  isCollaborator={isCollaborator}
                  isSpectator={isSpectator}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  pendingImages={pendingImages}
                  onPendingImagesChange={setPendingImages}
                  suggestions={suggestions}
                  suggestText={suggestText}
                  onSuggestTextChange={setSuggestText}
                  onSubmit={handleRunTask}
                  onCancel={handleCancel}
                  onFire={handleFire}
                  onApproval={handleApproval}
                  onApprovePlan={handleApprovePlan}
                  onQuickApprove={() => {
                    if (!selectedAgent) return;
                    const taskId = 'task-' + Date.now().toString(36);
                    addUserMessage(selectedAgent, taskId, "yes");
                    sendCommand({ type: "RUN_TASK", agentId: selectedAgent, taskId, prompt: "yes", repoPath: agentWorkDirMap.get(selectedAgent) });
                  }}
                  onEndProject={handleEndProject}
                  onSuggest={handleSuggest}
                  onPreview={setPreviewUrl}
                  autoMerge={ag.autoMerge}
                  pendingMerge={ag.pendingMerge}
                  lastMergeCommit={ag.lastMergeCommit}
                  lastMergeMessage={ag.lastMergeMessage}
                  undoCount={ag.undoCount}
                  onMerge={() => sendCommand({ type: "MERGE_WORKTREE", agentId: selectedAgent })}
                  onRevert={() => sendCommand({ type: "REVERT_WORKTREE", agentId: selectedAgent })}
                  onUndoMerge={async () => {
                    const ag = agents.get(selectedAgent);
                    const hash = ag?.lastMergeCommit?.slice(0, 7) ?? "???";
                    const msg = ag?.lastMergeMessage || "merge commit";
                    if (await confirm(`Undo merge ${hash}?\n"${msg}"\n\nThis will remove the merge commit from main.`)) {
                      sendCommand({ type: "UNDO_MERGE", agentId: selectedAgent });
                    }
                  }}
                  onReview={(result, backend) => handleReview(selectedAgent, result, backend)}
                  detectedBackends={detectedBackends}
                  onLoadMore={() => loadMoreMessages(selectedAgent)}
                  onPasteImage={handlePasteImage}
                  onPasteText={handlePasteText}
                  onDropImage={handleDropImage}
                  reviewerOverlay={reviewOverlays.has(selectedAgent) ? getReviewerData(selectedAgent) : null}
                  onReviewerLoadMore={reviewOverlays.has(selectedAgent) ? () => loadMoreMessages(reviewOverlays.get(selectedAgent)!.reviewerAgentId) : undefined}
                  onApplyReviewFixes={reviewOverlays.has(selectedAgent) ? (feedback) => handleApplyReviewFixes(selectedAgent, feedback) : undefined}
                  onDismissReview={reviewOverlays.has(selectedAgent) ? () => handleDismissReview(selectedAgent) : undefined}
                  scrollFrozen={scrollFrozen}
                />
              );
            })() : (
              inlineTemplateSelector || (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a3a", fontFamily: TERM_FONT, fontSize: TERM_SIZE }}>
                  {activeAgentList.length > 0 ? "Select an agent" : ""}
                </div>
              )
            )}

            {/* Team Activity log */}
            {teamMessages.length > 0 && (
              <TeamActivityLog messages={teamMessages} agents={agents} assetsReady={assetsReady} onClear={clearTeamMessages} />
            )}

            </>);
          })()}

          </div>
        </div>
      </>}

      {/* ── Mobile: bottom agent bar ── */}
      {isMobile && agentList.length > 0 && !isChatExpanded && !mobileTeamOpen && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          background: "linear-gradient(to top, var(--term-bg) 0%, color-mix(in srgb, var(--term-bg) 70%, transparent) 80%, transparent 100%)",
          overflowX: "auto",
        }}>
          {/* Hire button (owner only) */}
          {isOwner && (
            <button
              onClick={() => setShowHireModal(true)}
              style={{
                width: 44, height: 44, flexShrink: 0,
                border: `1px solid ${TERM_ACCENT}60`, backgroundColor: `${TERM_ACCENT}1e`,
                color: TERM_ACCENT, fontSize: TERM_SIZE_XL, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >+</button>
          )}
          {/* Team button */}
          <button
            onClick={() => setMobileTeamOpen(true)}
            style={{
              width: 44, height: 44, flexShrink: 0,
              border: `1px solid ${TERM_SEM_YELLOW}70`, backgroundColor: `${TERM_SEM_YELLOW}20`,
              color: TERM_SEM_YELLOW, fontSize: TERM_SIZE_XS, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "monospace",
            }}
          >Team</button>
          {agentList.map((agent) => {
            const cfg = getStatusConfig()[agent.status] ?? getStatusConfig().idle;
            return (
              <button
                key={agent.agentId}
                aria-label={`Chat with ${agent.name} (${cfg.label})`}
                onClick={() => { setSelectedAgent(agent.agentId); setChatOpen(true); }}
                style={{
                  position: "relative", flexShrink: 0,
                  width: 44, height: 44,
                  border: selectedAgent === agent.agentId ? `1px solid ${TERM_SEM_YELLOW}` : `1px solid ${TERM_BORDER_DIM}`,
                  backgroundColor: TERM_PANEL,
                  cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <SpriteAvatar palette={agent.palette ?? 0} zoom={1} ready={assetsReady} />
                <span aria-hidden="true" style={{
                  position: "absolute", bottom: 2, right: 2,
                  width: 6, height: 6,
                  backgroundColor: cfg.color, border: `1px solid ${TERM_PANEL}`,
                }} />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Mobile: full-screen chat overlay ── */}
      {isMobile && isChatExpanded && (() => {
        const agentState = selectedAgent ? agents.get(selectedAgent) : null;
        if (!agentState) return null;
        const cfg = getStatusConfig()[agentState.status] ?? getStatusConfig().idle;
        const busy = agentState.status === "working" || agentState.status === "waiting_approval";
        const mobileIsTeamMember = !!agentState.teamId && !agentState.isTeamLead;
        return (
          <div style={{
            position: "absolute", inset: 0, zIndex: 30,
            backgroundColor: TERM_BG,
            display: "flex", flexDirection: "column",
          }}>
            {/* Header — semantic button for accessibility */}
            <button
              onClick={() => setChatOpen(false)}
              aria-label={`Close chat with ${agentState.name}`}
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${TERM_BORDER_DIM}`,
                border: "none", borderBottomStyle: "solid", borderBottomWidth: 1, borderBottomColor: TERM_BORDER_DIM,
                display: "flex", alignItems: "center", gap: 10,
                flexShrink: 0,
                backgroundColor: TERM_PANEL,
                cursor: "pointer",
                width: "100%", textAlign: "left",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: TERM_SIZE_ICON, color: TERM_DIM, marginRight: 4 }}>&larr;</span>
              <SpriteAvatar palette={agentState.palette ?? 0} zoom={2} ready={assetsReady} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: TERM_SIZE, fontWeight: 700, color: TERM_TEXT_BRIGHT, display: "flex", alignItems: "center", gap: 4 }}>
                  {agentState.name}
                  {agentState.isTeamLead && (
                    <span style={{ fontSize: TERM_SIZE_3XS, padding: "1px 4px", backgroundColor: `${TERM_SEM_YELLOW}28`, color: TERM_SEM_YELLOW, border: `1px solid ${TERM_SEM_YELLOW}60`, fontFamily: "monospace" }}>LEAD</span>
                  )}
                  {mobileIsTeamMember && (
                    <span style={{ fontSize: TERM_SIZE_3XS, padding: "1px 4px", backgroundColor: `${TERM_SEM_YELLOW}20`, color: TERM_SEM_YELLOW, border: `1px solid ${TERM_SEM_YELLOW}50`, fontFamily: "monospace" }}>TEAM</span>
                  )}
                  {agentState.tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={agentState.tokenUsage.inputTokens} outputTokens={agentState.tokenUsage.outputTokens} cacheReadTokens={agentState.tokenUsage.cacheReadTokens} cacheWriteTokens={agentState.tokenUsage.cacheWriteTokens} costUsd={agentState.tokenUsage.costUsd} />}
                </div>
                <div style={{ fontSize: TERM_SIZE_XS, color: TERM_DIM }}>{agentState.role}</div>
              </div>
              <span style={{
                fontSize: TERM_SIZE_2XS, padding: "2px 6px",
                backgroundColor: cfg.color + "18", color: cfg.color,
                border: `1px solid ${cfg.color}40`,
                flexShrink: 0, fontFamily: "monospace",
              }}>
                {cfg.label}
              </span>
            </button>

            {/* Messages */}
            <div data-scrollbar style={{
              flex: 1, overflowY: "auto", padding: "8px 10px",
              display: "flex", flexDirection: "column",
            }}>
              {/* Phase banner for team leads (mobile) */}
              {agentState.isTeamLead && (() => {
                const phase = getAgentPhase(agentState.agentId);
                if (!phase) return null;
                const PHASE_INFO: Record<string, { color: string; icon: string; hint: string }> = {
                  create: { color: TERM_SEM_BLUE, icon: "💬", hint: "Define the project" },
                  design: { color: TERM_SEM_YELLOW, icon: "📋", hint: "Review the plan" },
                  execute: { color: TERM_SEM_YELLOW, icon: "⚡", hint: "Team is building" },
                  complete: { color: TERM_SEM_GREEN, icon: "✓", hint: "Review results" },
                };
                const info = PHASE_INFO[phase];
                if (!info) return null;
                return (
                  <div style={{
                    padding: "5px 8px", marginBottom: 8,
                    backgroundColor: info.color + "10",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    border: `1px solid ${info.color}30`,
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: TERM_SIZE_XS, fontFamily: "monospace",
                  }}>
                    <span aria-hidden="true">{info.icon}</span>
                    <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: TERM_SIZE_3XS, letterSpacing: "0.05em" }}>{phase}</span>
                    <span style={{ color: TERM_DIM }}>{info.hint}</span>
                  </div>
                );
              })()}

              {agentState.messages.length === 0 && (
                <div style={{ textAlign: "center", color: TERM_DIM, padding: 20, fontSize: TERM_SIZE, fontFamily: "monospace" }}>
                  {mobileIsTeamMember ? "This agent is managed by the Team Lead" : ""}
                </div>
              )}

              {(() => {
                const visible = getVisibleMessages(agentState.agentId);
                const hasMore = visible.length < agentState.messages.length;
                return <>
                  {hasMore && <LoadMoreSentinel onLoadMore={() => loadMoreMessages(agentState.agentId)} />}
                  {visible.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} agentName={agentState.name} onPreview={setPreviewUrl} isTeamLead={agentState.isTeamLead} isTeamMember={mobileIsTeamMember} teamPhase={agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null} />
                  ))}
                </>;
              })()}


              {agentState.pendingApproval && (
                <div style={{
                  marginBottom: 8, padding: 12,
                  backgroundColor: TERM_SURFACE, border: `1px solid ${TERM_SEM_YELLOW}`,
                }}>
                  <div style={{ fontSize: TERM_SIZE_SM, fontWeight: "bold", color: TERM_SEM_YELLOW, marginBottom: 6, fontFamily: "monospace" }}>
                    ▲ {agentState.pendingApproval.title}
                  </div>
                  <div style={{ fontSize: TERM_SIZE, color: TERM_TEXT, marginBottom: 10, lineHeight: 1.5 }}>
                    {agentState.pendingApproval.summary}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "yes")}
                      style={{ flex: 1, padding: "8px", border: `1px solid ${TERM_SEM_GREEN}`, backgroundColor: TERM_PANEL, color: TERM_SEM_GREEN, cursor: "pointer", fontWeight: "bold", fontSize: TERM_SIZE_SM, fontFamily: "monospace" }}
                    >▶ Approve</button>
                    <button
                      onClick={() => handleApproval(agentState.pendingApproval!.approvalId, "no")}
                      style={{ flex: 1, padding: "8px", border: `1px solid ${TERM_SEM_RED}`, backgroundColor: TERM_PANEL, color: TERM_SEM_RED, cursor: "pointer", fontWeight: "bold", fontSize: TERM_SIZE_SM, fontFamily: "monospace" }}
                    >✕ Reject</button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Suggestion feed (mobile) */}
            {!isSpectator && suggestions.length > 0 && (
              <div data-scrollbar style={{
                padding: "6px 10px", borderTop: "1px solid #152515",
                backgroundColor: TERM_BG, maxHeight: 80, overflowY: "auto",
              }}>
                <div style={{ fontSize: TERM_SIZE_2XS, color: TERM_SEM_PURPLE, fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
                {suggestions.slice(-5).map((s, i) => (
                  <div key={i} style={{ fontSize: TERM_SIZE_XS, color: TERM_SEM_PURPLE, marginBottom: 2, lineHeight: 1.3 }}>
                    <span style={{ color: "#7c3aed", fontWeight: 600 }}>{s.author}:</span> {s.text}
                  </div>
                ))}
              </div>
            )}

            {/* Input / Cancel */}
            {(() => {
              const mobilePhase = agentState.isTeamLead ? getAgentPhase(agentState.agentId) : null;

              // Spectator: read-only footer
              if (isSpectator) {
                return (
                  <div style={{
                    padding: "8px 10px", borderTop: "1px solid #152515",
                    backgroundColor: "#182844", flexShrink: 0,
                    fontSize: TERM_SIZE_SM, color: TERM_SEM_BLUE, fontFamily: "monospace", textAlign: "center",
                  }}>
                    Watching — read-only mode
                  </div>
                );
              }

              // Collaborator: suggest input only
              if (isCollaborator) {
                return (
                  <div style={{
                    padding: "8px 10px", borderTop: "1px solid #152515",
                    backgroundColor: TERM_SURFACE, flexShrink: 0,
                  }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={suggestText}
                        onChange={(e) => setSuggestText(e.target.value)}
                        onKeyDown={(e) => isRealEnter(e) && handleSuggest()}
                        placeholder="Share an idea..."
                        maxLength={500}
                        style={{
                          flex: 1, padding: "9px 12px", border: "1px solid #7c3aed40",
                          backgroundColor: TERM_BG, color: TERM_SEM_PURPLE, fontSize: TERM_SIZE, outline: "none",
                        }}
                      />
                      <button
                        onClick={handleSuggest}
                        disabled={!suggestText.trim()}
                        style={{
                          padding: "9px 14px", border: "none",
                          backgroundColor: suggestText.trim() ? "#a855f7" : TERM_PANEL,
                          color: suggestText.trim() ? "#fff" : TERM_DIM,
                          fontSize: TERM_SIZE, cursor: suggestText.trim() ? "pointer" : "default",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Suggest</button>
                    </div>
                  </div>
                );
              }

              return (
                <div style={{
                  padding: "8px 10px", borderTop: "1px solid #152515",
                  backgroundColor: TERM_SURFACE, flexShrink: 0,
                }}>
                  {mobileIsTeamMember ? (
                    <div style={{
                      textAlign: "center", color: TERM_DIM, fontSize: TERM_SIZE_SM, padding: "8px 0", fontFamily: "monospace",
                    }}>
                      Tasks are assigned by the Team Lead
                    </div>
                  ) : mobilePhase === "execute" && busy ? (
                    <button
                      onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                      style={{
                        width: "100%", padding: "9px 16px", border: `1px solid ${TERM_SEM_RED}`,
                        backgroundColor: TERM_PANEL, color: TERM_SEM_RED, fontSize: TERM_SIZE, cursor: "pointer", fontFamily: "monospace",
                      }}
                    >✕ Cancel current work</button>
                  ) : mobilePhase === "execute" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Send a message..."
                          style={{
                            flex: 1, padding: "9px 12px", border: `1px solid ${TERM_BORDER_DIM}`,
                            backgroundColor: TERM_BG, color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? TERM_SEM_YELLOW : TERM_SURFACE,
                            color: (prompt.trim() || pendingImages.length > 0) ? TERM_BG : TERM_DIM,
                            fontSize: TERM_SIZE, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                            fontWeight: 700, fontFamily: "monospace",
                          }}
                        >Send</button>
                      </div>
                      <button
                        onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                        style={{
                          width: "100%", padding: "9px 16px", border: `1px solid ${TERM_SEM_YELLOW}`,
                          backgroundColor: TERM_PANEL, color: TERM_SEM_YELLOW, fontSize: TERM_SIZE, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Close Project</button>
                    </div>
                  ) : mobilePhase === "design" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={handleApprovePlan}
                        style={{
                          width: "100%", padding: "9px 16px", border: `1px solid ${TERM_SEM_GREEN}`,
                          backgroundColor: TERM_PANEL, color: TERM_SEM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >▶ Approve Plan</button>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Or give feedback..."
                          style={{
                            flex: 1, padding: "9px 12px", border: `1px solid ${TERM_BORDER}`,
                            backgroundColor: TERM_BG, color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? TERM_ACCENT : TERM_PANEL,
                            color: (prompt.trim() || pendingImages.length > 0) ? TERM_BG : TERM_DIM,
                            fontSize: TERM_SIZE, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                            fontWeight: 700, fontFamily: "monospace",
                          }}
                        >Send</button>
                      </div>
                    </div>
                  ) : mobilePhase === "complete" && !busy ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={prompt}
                          onPaste={handlePasteText}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                          placeholder="Request changes..."
                          style={{
                            flex: 1, padding: "9px 12px", border: `1px solid ${TERM_BORDER}`,
                            backgroundColor: TERM_BG, color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleRunTask}
                          disabled={!prompt.trim() && pendingImages.length === 0}
                          style={{
                            padding: "9px 14px", border: "none",
                            backgroundColor: (prompt.trim() || pendingImages.length > 0) ? TERM_SEM_YELLOW : TERM_SURFACE,
                            color: (prompt.trim() || pendingImages.length > 0) ? TERM_BG : TERM_DIM,
                            fontSize: TERM_SIZE, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                            fontWeight: 700, fontFamily: "monospace",
                          }}
                        >Send</button>
                      </div>
                      <button
                        onClick={async () => { if (await confirm("End this project and start a new one?")) handleEndProject(); }}
                        style={{
                          width: "100%", padding: "9px 16px", border: `1px solid ${TERM_SEM_YELLOW}`,
                          backgroundColor: TERM_PANEL, color: TERM_SEM_YELLOW, fontSize: TERM_SIZE, cursor: "pointer",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Close Project</button>
                    </div>
                  ) : busy ? (
                    <button
                      onClick={async () => { if (await confirm("Cancel current work?")) handleCancel(); }}
                      style={{
                        width: "100%", padding: "9px 16px", border: `1px solid ${TERM_SEM_RED}`,
                        backgroundColor: TERM_PANEL, color: TERM_SEM_RED, fontSize: TERM_SIZE, cursor: "pointer", fontFamily: "monospace",
                      }}
                    >✕ Cancel current work</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={prompt}
                        onPaste={handlePasteText}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => isRealEnter(e) && handleRunTask()}
                        placeholder="Send a message..."
                        style={{
                          flex: 1, padding: "9px 12px", border: `1px solid ${TERM_BORDER}`,
                          backgroundColor: TERM_BG, color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        }}
                        autoFocus
                      />
                      <button
                        onClick={handleRunTask}
                        disabled={!prompt.trim() && pendingImages.length === 0}
                        style={{
                          padding: "9px 14px", border: "none",
                          backgroundColor: (prompt.trim() || pendingImages.length > 0) ? TERM_ACCENT : TERM_PANEL,
                          color: (prompt.trim() || pendingImages.length > 0) ? TERM_BG : TERM_DIM,
                          fontSize: TERM_SIZE, cursor: (prompt.trim() || pendingImages.length > 0) ? "pointer" : "default",
                          fontWeight: 700, fontFamily: "monospace",
                        }}
                      >Send</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Mobile: Team chat fullscreen overlay */}
      {isMobile && mobileTeamOpen && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 30,
          backgroundColor: TERM_BG,
          display: "flex", flexDirection: "column",
        }}>
          <div
            onClick={() => setMobileTeamOpen(false)}
            style={{
              padding: "12px 14px", borderBottom: "1px solid #152515",
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
              backgroundColor: TERM_PANEL, cursor: "pointer",
            }}
          >
            <span style={{ fontSize: TERM_SIZE_ICON, color: TERM_DIM, marginRight: 4 }}>&larr;</span>
            <div style={{ fontSize: TERM_SIZE, fontWeight: 700, color: TERM_TEXT_BRIGHT }}>Team Chat</div>
            <span style={{ fontSize: TERM_SIZE_XS, color: TERM_DIM, fontFamily: "monospace" }}>{teamMessages.length} messages</span>
          </div>
          <TeamChatView messages={teamMessages} agents={agents} assetsReady={assetsReady} />
        </div>
      )}

      {showNewProjectModal && (
        <NewProjectModal
          open={showNewProjectModal}
          onClose={() => { setShowNewProjectModal(false); setNewProjectBlank(false); }}
          onCreated={handleProjectCreated}
          initialBlank={newProjectBlank}
        />
      )}

      {showHireModal && (
        <HireModal
          agentDefs={agentDefs}
          onHire={handleHire}
          onCreate={() => { setShowHireModal(false); setEditingAgent(null); setShowCreateAgent(true); }}
          onEdit={(def) => { setShowHireModal(false); setEditingAgent(def); setShowCreateAgent(true); }}
          onDelete={handleDeleteAgentDef}
          onClose={() => setShowHireModal(false)}
          assetsReady={assetsReady}
          detectedBackends={detectedBackends}
          projectDir={getActiveProject()?.directory}
        />
      )}

      {showHireTeamModal && (
        <HireTeamModal agentDefs={agentDefs} onCreateTeam={handleCreateTeam} onClose={() => setShowHireTeamModal(false)} assetsReady={assetsReady} detectedBackends={detectedBackends} projectDir={getActiveProject()?.directory} />
      )}

      {showCreateAgent && (
        <CreateAgentModal
          onSave={handleSaveAgentDef}
          onClose={() => { setShowCreateAgent(false); setEditingAgent(null); }}
          assetsReady={assetsReady}
          editAgent={editingAgent}
          sendCommand={sendCommand}
        />
      )}

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        layout={officeStateRef.current?.layout ?? null}
        onImportLayout={handleImportLayout}
        onImportRoomZip={handleImportRoomZip}
        soundEnabled={soundEnabled}
        onSoundEnabledChange={setSoundEnabled}
        consoleCols={consoleCols}
        consoleRows={consoleRows}
        onConsoleColsChange={(v) => { setConsoleCols(v); localStorage.setItem('office-console-cols', JSON.stringify(v)); }}
        onConsoleRowsChange={(v) => { setConsoleRows(v); localStorage.setItem('office-console-rows', JSON.stringify(v)); }}
      />

      <OfficeSwitcher
        isOpen={showOfficeSwitcher}
        onClose={() => setShowOfficeSwitcher(false)}
        onSelect={(layout, backgroundImage) => {
          setAssetsReady(false);
          handleImportRoomZip(layout, backgroundImage);
          try { const id = localStorage.getItem('office-selected-id'); if (id) setCurrentOfficeId(id); } catch {}
          // Brief delay so the loading overlay shows the walking animation
          setTimeout(() => setAssetsReady(true), 800);
        }}
        currentOfficeId={currentOfficeId}
      />

      <ProjectHistory
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onPreview={(preview, ratings) => {
          const url = computePreviewUrl(preview);
          if (url) setPreviewUrl(url);
          if (ratings && Object.keys(ratings).length > 0) {
            setPreviewRatings(ratings as Ratings);
            setPreviewRated(true);
          }
        }}
      />

      <UsagePanel
        isOpen={showUsage}
        onClose={() => setShowUsage(false)}
      />

      <DashboardPanel
        isOpen={showDashboard}
        onClose={() => setShowDashboard(false)}
      />

      <MemoryPanel
        isOpen={showMemory}
        onClose={() => { setShowMemory(false); setMemoryAgentId(null); }}
        initialAgentId={memoryAgentId}
      />

      {previewUrl && (
        <PreviewOverlay
          url={previewUrl}
          savedRatings={previewRatings}
          submitted={previewRated}
          onRate={(r) => {
            setPreviewRatings(r as Ratings);
            setPreviewRated(true);
            sendCommand({ type: "RATE_PROJECT", ratings: r });
          }}
          onClose={() => setPreviewUrl(null)}
        />
      )}

      {showConfetti && <ConfettiOverlay />}
      {celebration && (
        <CelebrationModal
          previewUrl={celebration.previewUrl}
          previewPath={celebration.previewPath}
          previewCmd={celebration.previewCmd}
          previewPort={celebration.previewPort}
          projectDir={celebration.projectDir}
          entryFile={celebration.entryFile}
          onPreview={(url) => { setPreviewUrl(url); setCelebration(null); setShowConfetti(false); }}
          onDismiss={() => { setCelebration(null); setShowConfetti(false); }}
        />
      )}
      {/* Share link modal */}
      {shareUrl && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShareUrl(null)}>
          <div style={{
            backgroundColor: TERM_PANEL, border: `1px solid ${TERM_BORDER}`,
            padding: 24, maxWidth: 420, width: "90%",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: TERM_SIZE, fontWeight: 700, color: TERM_TEXT_BRIGHT, marginBottom: 12 }}>Share Link Created</div>
            <div style={{ fontSize: TERM_SIZE_SM, color: TERM_DIM, marginBottom: 8 }}>Link copied to clipboard!</div>
            <input
              readOnly
              value={shareUrl}
              style={{
                width: "100%", padding: "8px 10px", border: `1px solid ${TERM_BORDER}`,
                backgroundColor: TERM_BG, color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE_SM,
                fontFamily: "monospace", outline: "none",
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              onClick={() => setShareUrl(null)}
              style={{
                marginTop: 12, padding: "8px 20px", border: "none",
                backgroundColor: TERM_ACCENT, color: TERM_BG, fontSize: TERM_SIZE,
                cursor: "pointer", fontWeight: 700, fontFamily: "monospace",
              }}
            >OK</button>
          </div>
        </div>
      )}

      {confirmModal}

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        currentTheme={termTheme}
        onThemeChange={(key) => setTermTheme(key)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onHire={() => setShowHireModal(true)}
      />

      {/* Demo mode button */}
      {showDemoButton && !demoRunning && (
        <button
          onClick={() => {
            setDemoRunning(true);
            runDemoScript(() => setDemoRunning(false));
          }}
          style={{
            position: "fixed", bottom: 16, left: 16, zIndex: 50,
            background: `${TERM_ACCENT}26`, border: `1px solid ${TERM_ACCENT}66`,
            color: TERM_ACCENT, padding: "6px 14px", cursor: "pointer",
            fontSize: TERM_SIZE_XS, fontFamily: "monospace", fontWeight: 600,
          }}
        >
          Run Demo
        </button>
      )}
    </div>
  );
}
