import { create } from "zustand";
import type { AgentStatus, GatewayEvent, TaskResultPayload, AgentDefinition, UserRole } from "@office/shared";
import { tunnelRewrite } from "@/components/office/ui/office-utils";
import { sendCommand } from "@/lib/connection";

/** Pending PICK_FOLDER callbacks: requestId → callback */
export const folderPickCallbacks = new Map<string, (path: string) => void>();
/** Pending UPLOAD_IMAGE callbacks: requestId → callback */
export const imageUploadCallbacks = new Map<string, (path: string) => void>();

// ── Tauri desktop notifications ──

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

function notifyTaskDone(agentName: string, summary: string) {
  if (!isTauri) return;
  // Skip if window is focused — no need to distract
  if (typeof document !== "undefined" && document.hasFocus()) return;
  // Dock bounce
  // @ts-ignore — only available in Tauri context
  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("bounce_dock").catch(() => {});
  }).catch(() => {});
  // Native notification
  // @ts-ignore — only available in Tauri context
  import("@tauri-apps/plugin-notification").then(async ({ sendNotification, isPermissionGranted, requestPermission }: any) => {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({
        title: `${agentName} — Task Complete`,
        body: summary.slice(0, 200),
      });
    }
  }).catch(() => {});
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  timestamp: number;
  result?: TaskResultPayload;
  isFinalResult?: boolean;
  durationMs?: number;
  /** Accumulated full output from LOG_APPEND (streaming only) */
  _accumulatedText?: string;
}

interface AgentState {
  agentId: string;
  name: string;
  role: string;
  palette?: number;
  personality?: string;
  backend?: string;
  isTeamLead?: boolean;
  teamId?: string;
  isExternal?: boolean;
  pid?: number;
  cwd?: string;
  workDir?: string;
  startedAt?: number;
  status: AgentStatus;
  currentTaskId: string | null;
  currentPrompt: string | null;
  awaitingApproval: boolean;
  pendingApproval: {
    approvalId: string;
    title: string;
    summary: string;
    riskLevel: string;
  } | null;
  messages: ChatMessage[];
  lastLogLine: string | null;
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** Accumulated token baseline from completed tasks (live TOKEN_UPDATE adds on top) */
  _tokenBaseline?: { inputTokens: number; outputTokens: number };
  autoMerge?: boolean;
  pendingMerge?: boolean;
  lastMergeCommit?: string | null;
  lastMergeMessage?: string | null;
  undoCount?: number;
}

export interface TeamChatMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId?: string;
  toAgentName?: string;
  message: string;
  messageType: "delegation" | "result" | "status" | "warning";
  timestamp: number;
}

export interface TeamPhaseState {
  phase: string;
  leadAgentId: string;
}

export interface Suggestion {
  text: string;
  author: string;
  timestamp: number;
}

// ── Project concept (Phase 1: project-centric architecture) ──

export interface Project {
  id: string;
  name: string;
  directory: string;       // set once at creation
  agentIds: string[];      // agents in this project
  teamId?: string;         // if team mode
  status: "active" | "archived";
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  agentNames: string[];
  eventCount: number;
  preview?: {
    entryFile?: string;
    projectDir?: string;
    previewCmd?: string;
    previewPort?: number;
  };
  tokenUsage?: { inputTokens: number; outputTokens: number };
  ratings?: Record<string, number>;
}

interface OfficeStore {
  agents: Map<string, AgentState>;
  teamMessages: TeamChatMessage[];
  teamPhases: Map<string, TeamPhaseState>;
  agentDefs: AgentDefinition[];
  role: UserRole;
  suggestions: Suggestion[];
  // ── Project-centric state ──
  projects: Map<string, Project>;
  activeProjectId: string | null;
  pendingTeamProjectId: string | null;
  projectList: ProjectSummary[];
  viewingProjectId: string | null;
  viewingProjectEvents: GatewayEvent[];
  viewingProjectName: string | null;
  pendingPreviewUrl: string | null;
  configResult: { success: boolean; message: string; telegramConnected?: boolean; tunnelRunning?: boolean } | null;
  configData: { telegramBotToken?: string; telegramAllowedUsers?: string[]; telegramConnected?: boolean; worktreeEnabled?: boolean; autoMergeEnabled?: boolean; tunnelBaseUrl?: string; tunnelToken?: string; tunnelRunning?: boolean } | null;
  detectedBackends: string[];
  availableSkills: Array<{ name: string; title: string; isFolder: boolean }>;
  connected: boolean;
  hydrated: boolean;
  /** Separated from agents to avoid full Map clone on every LOG_APPEND */
  agentLogLines: Map<string, string>;
  /** Per-agent visible message count for lazy loading (default: 50) */
  visibleMessageCount: Map<string, number>;
  consumePreviewUrl: () => string | null;
  setConnected: (c: boolean) => void;
  setRole: (role: UserRole) => void;
  hydrate: () => void;
  handleEvent: (event: GatewayEvent) => void;
  getAgent: (id: string) => AgentState;
  getVisibleMessages: (agentId: string) => ChatMessage[];
  loadMoreMessages: (agentId: string) => void;
  addUserMessage: (agentId: string, taskId: string, prompt: string) => void;
  removeAgent: (agentId: string) => void;
  clearTeamMessages: () => void;
  clearViewingProject: () => void;
  // ── Project actions ──
  createProject: (name: string, directory: string) => string;
  setActiveProject: (projectId: string | null) => void;
  addAgentToProject: (projectId: string, agentId: string) => void;
  removeAgentFromProject: (projectId: string, agentId: string) => void;
  archiveProject: (projectId: string) => void;
  getActiveProject: () => Project | null;
  getProjectAgentIds: () => string[];
}

// ── localStorage persistence ──
// Keys are scoped by gatewayId so desktop and web dev gateways don't overwrite each other's data.

function getGatewayId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("office_connection") ?? localStorage.getItem("office_connection");
    if (!raw) return null;
    return JSON.parse(raw).gatewayId ?? null;
  } catch { return null; }
}

function scopedKey(base: string): string {
  const gid = getGatewayId();
  return gid ? `${base}:${gid}` : base;
}

const STORAGE_KEY_BASE = "office-chat-history";

interface PersistedAgent {
  agentId: string;
  name: string;
  role: string;
  palette?: number;
  personality?: string;
  backend?: string;
  isTeamLead?: boolean;
  teamId?: string;
  messages: ChatMessage[];
}

function isBrowser() {
  return typeof window !== "undefined";
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function filterRecentMessages(messages: ChatMessage[]): ChatMessage[] {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  return messages.filter((m) => m.timestamp >= cutoff);
}

// Throttled save — writes at most once per 2 seconds to avoid blocking main thread
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: Map<string, AgentState> | null = null;

function _flushSave() {
  _saveTimer = null;
  const agents = _pendingSave;
  _pendingSave = null;
  if (!agents) return;
  try {
    const data: PersistedAgent[] = [];
    for (const [, agent] of agents) {
      // Skip temporary reviewers — they are transient
      if (agent.agentId.startsWith("reviewer-")) continue;
      const recentMessages = filterRecentMessages(agent.messages);
      if (recentMessages.length > 0 || agent.name !== agent.agentId) {
        data.push({
          agentId: agent.agentId,
          name: agent.name,
          role: agent.role,
          palette: agent.palette,
          personality: agent.personality,
          backend: agent.backend,
          isTeamLead: agent.isTeamLead,
          teamId: agent.teamId,
          messages: recentMessages.map(({ _accumulatedText, ...m }) => m),
        });
      }
    }
    const json = JSON.stringify(data);
    localStorage.setItem(scopedKey(STORAGE_KEY_BASE), json);
    invalidateStorageCache();
    // Also sync to gateway for persistence across webview rebuilds
    try { sendCommand({ type: "SYNC_CHAT_HISTORY", data: json }); } catch { /* not connected */ }
  } catch {
    // quota exceeded or unavailable
  }
}

function saveToStorage(agents: Map<string, AgentState>) {
  if (!isBrowser()) return;
  _pendingSave = agents;
  if (!_saveTimer) {
    _saveTimer = setTimeout(_flushSave, 2000);
  }
}

function loadFromStorage(): Map<string, PersistedAgent> {
  if (!isBrowser()) return new Map();
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY_BASE));
    if (!raw) return new Map();
    const data: PersistedAgent[] = JSON.parse(raw);
    const map = new Map<string, PersistedAgent>();
    for (const item of data) {
      item.messages = filterRecentMessages(item.messages);
      map.set(item.agentId, item);
    }
    return map;
  } catch {
    return new Map();
  }
}

// ── Cached localStorage snapshot ──
// Populated once during hydrate(), used by AGENT_CREATED to avoid
// repeated JSON.parse of the full storage blob.
let _storageCache: Map<string, PersistedAgent> | null = null;

function getCachedStorage(): Map<string, PersistedAgent> {
  if (_storageCache) return _storageCache;
  _storageCache = loadFromStorage();
  return _storageCache;
}

/** Invalidate cache when we know storage has changed (e.g. after save) */
function invalidateStorageCache() {
  _storageCache = null;
}

// Flush pending save on page unload to avoid data loss
if (isBrowser()) {
  window.addEventListener("beforeunload", _flushSave);
}

function removeFromStorage(_agentId: string) {
  // No-op: the next throttled saveToStorage() call will exclude this agent
  // because it's already been removed from the agents Map.
  // Only invalidate the cache so getCachedStorage() re-reads if needed.
  invalidateStorageCache();
}

// ── Team messages persistence ──

const TEAM_STORAGE_KEY_BASE = "office-team-messages";

function saveTeamMessages(messages: TeamChatMessage[]) {
  if (!isBrowser()) return;
  try {
    // Keep last 200 messages
    const trimmed = messages.slice(-200);
    localStorage.setItem(scopedKey(TEAM_STORAGE_KEY_BASE), JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

function loadTeamMessages(): TeamChatMessage[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(scopedKey(TEAM_STORAGE_KEY_BASE));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Project persistence ──

const PROJECT_STORAGE_KEY_BASE = "office-projects";

function saveProjects(projects: Map<string, Project>) {
  if (!isBrowser()) return;
  try {
    const data: Project[] = Array.from(projects.values());
    localStorage.setItem(scopedKey(PROJECT_STORAGE_KEY_BASE), JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function loadProjects(): Map<string, Project> {
  if (!isBrowser()) return new Map();
  try {
    const raw = localStorage.getItem(scopedKey(PROJECT_STORAGE_KEY_BASE));
    if (!raw) return new Map();
    const data: Project[] = JSON.parse(raw);
    const map = new Map<string, Project>();
    for (const p of data) map.set(p.id, p);
    return map;
  } catch { return new Map(); }
}

// ── Team phase persistence ──

const TEAM_PHASE_KEY_BASE = "office-team-phase";

function saveTeamPhases(phases: Map<string, TeamPhaseState>) {
  if (!isBrowser()) return;
  try {
    const data: Record<string, TeamPhaseState> = {};
    for (const [k, v] of phases) data[k] = v;
    localStorage.setItem(scopedKey(TEAM_PHASE_KEY_BASE), JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function loadTeamPhases(): Map<string, TeamPhaseState> {
  if (!isBrowser()) return new Map();
  try {
    const raw = localStorage.getItem(scopedKey(TEAM_PHASE_KEY_BASE));
    if (!raw) return new Map();
    const data: Record<string, TeamPhaseState> = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

// ── Store ──

function defaultAgent(agentId: string, name = agentId, role = ""): AgentState {
  return {
    agentId,
    name,
    role,
    status: "idle",
    currentTaskId: null,
    currentPrompt: null,
    awaitingApproval: false,
    pendingApproval: null,
    messages: [],
    lastLogLine: null,
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

export const useOfficeStore = create<OfficeStore>((set, get) => ({
  agents: new Map(),
  agentDefs: [],
  teamMessages: [],
  teamPhases: new Map(),
  role: "owner" as UserRole,
  suggestions: [],
  projects: new Map(),
  activeProjectId: null,
  pendingTeamProjectId: null,
  projectList: [],
  viewingProjectId: null,
  viewingProjectEvents: [],
  viewingProjectName: null,
  pendingPreviewUrl: null,
  configResult: null,
  configData: null,
  detectedBackends: [],
  availableSkills: [],
  connected: false,
  hydrated: false,
  agentLogLines: new Map(),
  visibleMessageCount: new Map(),

  consumePreviewUrl: () => {
    const url = get().pendingPreviewUrl;
    if (url) set({ pendingPreviewUrl: null });
    return url;
  },
  setConnected: (c) => set({ connected: c }),
  setRole: (role) => set({ role }),

  hydrate: () => {
    if (get().hydrated) return;
    const saved = getCachedStorage();
    const savedTeamMessages = loadTeamMessages();
    const savedTeamPhases = loadTeamPhases();
    const savedProjects = loadProjects();
    const savedActiveProject = isBrowser()
      ? (localStorage.getItem(scopedKey("office-active-project")) || null)
      : null;
    if (saved.size === 0 && savedTeamMessages.length === 0 && savedTeamPhases.size === 0 && savedProjects.size === 0) { set({ hydrated: true, teamMessages: savedTeamMessages, teamPhases: savedTeamPhases, projects: savedProjects, activeProjectId: savedActiveProject }); return; }
    set((state) => {
      const agents = new Map(state.agents);
      for (const [agentId, persisted] of saved) {
        if (!agents.has(agentId)) {
          agents.set(agentId, {
            ...defaultAgent(agentId, persisted.name, persisted.role),
            palette: persisted.palette,
            personality: persisted.personality,
            backend: persisted.backend,
            isTeamLead: persisted.isTeamLead,
            teamId: persisted.teamId,
            messages: persisted.messages,
          });
        }
      }
      return { agents, teamMessages: savedTeamMessages, teamPhases: savedTeamPhases, projects: savedProjects, activeProjectId: savedActiveProject, hydrated: true };
    });
  },

  getAgent: (id) => {
    return get().agents.get(id) ?? defaultAgent(id);
  },

  getVisibleMessages: (agentId) => {
    const agent = get().agents.get(agentId);
    if (!agent) return [];
    const limit = get().visibleMessageCount.get(agentId) ?? 20;
    const msgs = agent.messages;
    return msgs.length <= limit ? msgs : msgs.slice(-limit);
  },

  loadMoreMessages: (agentId) => {
    set((state) => {
      const vmc = new Map(state.visibleMessageCount);
      const current = vmc.get(agentId) ?? 20;
      vmc.set(agentId, current + 20);
      return { visibleMessageCount: vmc };
    });
  },

  removeAgent: (agentId) => {
    set((state) => {
      const agents = new Map(state.agents);
      agents.delete(agentId);
      removeFromStorage(agentId);
      const vmc = new Map(state.visibleMessageCount);
      vmc.delete(agentId);
      return { agents, visibleMessageCount: vmc };
    });
  },

  clearTeamMessages: () => {
    saveTeamMessages([]);
    saveTeamPhases(new Map());
    set({ teamMessages: [], teamPhases: new Map() });
  },

  clearViewingProject: () => {
    set({ viewingProjectId: null, viewingProjectEvents: [], viewingProjectName: null });
  },

  // ── Project actions ──

  createProject: (name, directory) => {
    const id = "proj-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const project: Project = { id, name, directory, agentIds: [], status: "active", createdAt: Date.now() };
    set((state) => {
      const projects = new Map(state.projects);
      projects.set(id, project);
      saveProjects(projects);
      return { projects, activeProjectId: id };
    });
    return id;
  },

  setActiveProject: (projectId) => {
    set({ activeProjectId: projectId });
    if (isBrowser()) {
      try { localStorage.setItem(scopedKey("office-active-project"), projectId ?? ""); } catch {}
    }
  },

  addAgentToProject: (projectId, agentId) => {
    set((state) => {
      const projects = new Map(state.projects);
      const project = projects.get(projectId);
      if (!project) return state;
      if (project.agentIds.includes(agentId)) return state;
      projects.set(projectId, { ...project, agentIds: [...project.agentIds, agentId] });
      saveProjects(projects);
      return { projects };
    });
  },

  removeAgentFromProject: (projectId, agentId) => {
    set((state) => {
      const projects = new Map(state.projects);
      const project = projects.get(projectId);
      if (!project) return state;
      projects.set(projectId, { ...project, agentIds: project.agentIds.filter(id => id !== agentId) });
      saveProjects(projects);
      return { projects };
    });
  },

  archiveProject: (projectId) => {
    set((state) => {
      const projects = new Map(state.projects);
      const project = projects.get(projectId);
      if (!project) return state;
      projects.set(projectId, { ...project, status: "archived" });
      const nextActive = state.activeProjectId === projectId
        ? (Array.from(projects.values()).find(p => p.id !== projectId && p.status === "active")?.id ?? null)
        : state.activeProjectId;
      saveProjects(projects);
      return { projects, activeProjectId: nextActive };
    });
  },

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    return activeProjectId ? projects.get(activeProjectId) ?? null : null;
  },

  getProjectAgentIds: () => {
    const { projects, activeProjectId } = get();
    if (!activeProjectId) return [];
    return projects.get(activeProjectId)?.agentIds ?? [];
  },

  addUserMessage: (agentId, taskId, prompt) => {
    set((state) => {
      const agents = new Map(state.agents);
      const agent = agents.get(agentId) ?? defaultAgent(agentId);
      agents.set(agentId, {
        ...agent,
        messages: [...agent.messages, {
          id: taskId,
          role: "user",
          text: prompt,
          timestamp: Date.now(),
        }],
      });
      saveToStorage(agents);
      return { agents };
    });
  },

  handleEvent: (event) => {
    set((state) => {
      const agents = new Map(state.agents);

      switch (event.type) {
        case "AGENTS_SYNC": {
          // Remove agents that no longer exist on the gateway (e.g. after restart)
          const validIds = new Set(event.agentIds);
          for (const agentId of agents.keys()) {
            if (!validIds.has(agentId)) {
              agents.delete(agentId);
            }
          }
          break;
        }
        case "AGENT_CREATED": {
          if (event.lastMergeCommit !== undefined || event.pendingMerge !== undefined) {
            console.log(`[Store DEBUG] AGENT_CREATED: agentId=${event.agentId} pendingMerge=${event.pendingMerge} lastMergeCommit=${event.lastMergeCommit} lastMergeMessage=${event.lastMergeMessage}`);
          }
          const existing = agents.get(event.agentId);
          if (existing) {
            agents.set(event.agentId, {
              ...existing,
              name: event.name,
              role: event.role,
              palette: event.palette ?? existing.palette,
              personality: event.personality ?? existing.personality,
              backend: event.backend ?? existing.backend,
              isTeamLead: event.isTeamLead ?? existing.isTeamLead,
              teamId: event.teamId ?? existing.teamId,
              isExternal: event.isExternal ?? existing.isExternal,
              pid: event.pid ?? existing.pid,
              cwd: event.cwd ?? existing.cwd,
              workDir: event.workDir ?? existing.workDir,
              startedAt: event.startedAt ?? existing.startedAt,
              autoMerge: event.autoMerge ?? existing.autoMerge,
              pendingMerge: event.pendingMerge ?? existing.pendingMerge,
              lastMergeCommit: event.lastMergeCommit !== undefined ? event.lastMergeCommit : existing.lastMergeCommit,
              lastMergeMessage: event.lastMergeMessage !== undefined ? event.lastMergeMessage : existing.lastMergeMessage,
              undoCount: event.undoCount ?? existing.undoCount,
            });
          } else {
            const saved = getCachedStorage().get(event.agentId);
            const agent = defaultAgent(event.agentId, event.name, event.role);
            agent.palette = event.palette ?? saved?.palette;
            agent.personality = event.personality ?? saved?.personality;
            agent.backend = event.backend ?? saved?.backend;
            agent.isTeamLead = event.isTeamLead ?? saved?.isTeamLead;
            agent.teamId = event.teamId ?? saved?.teamId;
            agent.isExternal = event.isExternal;
            agent.pid = event.pid;
            agent.cwd = event.cwd;
            agent.workDir = event.workDir;
            agent.startedAt = event.startedAt;
            agent.autoMerge = event.autoMerge;
            agent.pendingMerge = event.pendingMerge;
            agent.lastMergeCommit = event.lastMergeCommit;
            agent.lastMergeMessage = event.lastMergeMessage;
            agent.undoCount = event.undoCount;
            if (saved) {
              agent.messages = saved.messages;
            }
            agents.set(event.agentId, agent);
          }
          // Skip localStorage persistence for temporary reviewers
          if (!event.agentId.startsWith("reviewer-")) {
            // Debug: detect isTeamLead loss
            const updated = agents.get(event.agentId);
            if (existing?.isTeamLead && !updated?.isTeamLead) {
              console.warn(`[Store] isTeamLead LOST for ${event.agentId}! event.isTeamLead=${event.isTeamLead}, existing=${existing.isTeamLead}`);
              console.trace();
            }
            saveToStorage(agents);
          }
          // Auto-associate team agents with the pending team project (set by handleCreateTeam)
          if (event.teamId && state.pendingTeamProjectId) {
            const proj = state.projects.get(state.pendingTeamProjectId);
            if (proj && !proj.agentIds.includes(event.agentId)) {
              const projects = new Map(state.projects);
              projects.set(proj.id, { ...proj, agentIds: [...proj.agentIds, event.agentId] });
              saveProjects(projects);
              return { agents, projects };
            }
          }
          break;
        }
        case "AGENT_FIRED": {
          agents.delete(event.agentId);
          removeFromStorage(event.agentId);
          saveToStorage(agents);  // Trigger throttled save to persist removal
          // Clean up team phase if this was a team lead
          const teamPhases = new Map(state.teamPhases);
          for (const [teamId, tp] of teamPhases) {
            if (tp.leadAgentId === event.agentId) {
              teamPhases.delete(teamId);
            }
          }
          if (teamPhases.size !== state.teamPhases.size) {
            saveTeamPhases(teamPhases);
            return { agents, teamPhases };
          }
          break;
        }
        case "AGENT_STATUS": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          agents.set(event.agentId, { ...agent, status: event.status });
          break;
        }
        case "TASK_STARTED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          // Add a streaming placeholder message that LOG_APPEND will update in-place
          // Finalize any stale streaming messages from previous tasks (stop them from updating)
          const streamId = event.taskId + "-stream";
          const hasStream = agent.messages.some((m) => m.id === streamId);
          const staleFinalized = agent.messages.map((m) =>
            m.id.endsWith("-stream") && m.id !== streamId
              ? { ...m, id: m.id.replace("-stream", "-streamed") }
              : m
          );
          // If no user message for this task yet (e.g. sent via Telegram),
          // inject one so the prompt appears in the App chat panel
          const hasUserMsg = staleFinalized.some((m) => m.id === event.taskId);
          const withUserMsg = hasUserMsg ? staleFinalized : [...staleFinalized, {
            id: event.taskId,
            role: "user" as const,
            text: event.prompt,
            timestamp: Date.now(),
          }];
          // Clear log line when new task starts
          const taskStartLogLines = new Map(state.agentLogLines);
          taskStartLogLines.delete(event.agentId);
          agents.set(event.agentId, {
            ...agent,
            status: "working",
            currentTaskId: event.taskId,
            currentPrompt: event.prompt,
            awaitingApproval: false,
            pendingApproval: null,
            lastLogLine: null,
            messages: hasStream ? withUserMsg : [...withUserMsg, {
              id: streamId,
              role: "agent" as const,
              text: "",
              timestamp: Date.now(),
            }],
          });
          return { agents, agentLogLines: taskStartLogLines };
        }
        case "APPROVAL_NEEDED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          agents.set(event.agentId, {
            ...agent,
            status: "waiting_approval",
            pendingApproval: {
              approvalId: event.approvalId,
              title: event.title,
              summary: event.summary,
              riskLevel: event.riskLevel,
            },
          });
          break;
        }
        case "TASK_DONE": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          const replyId = event.taskId + "-reply";
          if (agent.messages.some((m) => m.id === replyId)) break; // dedupe

          // Determine if leader is in a conversational phase
          let leaderConversational = false;
          if (agent.isTeamLead) {
            for (const [, tp] of state.teamPhases) {
              if (tp.leadAgentId === event.agentId) {
                leaderConversational = ["create", "design", "complete"].includes(tp.phase);
                break;
              }
            }
          }

          // Finalize token usage for this task.
          // If TOKEN_UPDATE was received during the task, agent.tokenUsage is already up-to-date
          // (baseline + live task tokens). Just snapshot it as the new baseline.
          // If no TOKEN_UPDATE was received (e.g. non-streaming backend), fall back to
          // accumulating from event.result.tokenUsage.
          const baseline = agent._tokenBaseline ?? { inputTokens: 0, outputTokens: 0 };
          const liveUpdated = agent.tokenUsage.inputTokens > baseline.inputTokens
            || agent.tokenUsage.outputTokens > baseline.outputTokens;
          const updatedTokenUsage = liveUpdated
            ? agent.tokenUsage  // TOKEN_UPDATE already set the correct value
            : (event.result.tokenUsage
              ? {
                  inputTokens: agent.tokenUsage.inputTokens + event.result.tokenUsage.inputTokens,
                  outputTokens: agent.tokenUsage.outputTokens + event.result.tokenUsage.outputTokens,
                }
              : agent.tokenUsage);

          // Team lead intermediate completions in EXECUTE phase (delegating, processing results)
          // should not appear as chat messages — only the final summary matters.
          // In conversational phases (create, design, complete), always show the message.
          if (agent.isTeamLead && !event.isFinalResult && !leaderConversational) {
            // Finalize streaming message for intermediate leader task (keep it visible)
            const intStreamId = event.taskId + "-stream";
            const intStreamMsg = agent.messages.find((m) => m.id === intStreamId);
            // Mark streaming message as finalized by removing the -stream suffix
            const finalizedMsgs = intStreamMsg
              ? agent.messages.map((m) => m.id === intStreamId ? { ...m, id: intStreamId.replace("-stream", "-streamed") } : m)
              : agent.messages;
            const intLogLines = new Map(state.agentLogLines);
            intLogLines.set(event.agentId, event.result.summary?.slice(0, 100) ?? "Coordinating team...");
            agents.set(event.agentId, {
              ...agent,
              status: "working",
              currentTaskId: null,
              pendingApproval: null,
              lastLogLine: event.result.summary?.slice(0, 100) ?? "Coordinating team...",
              messages: finalizedMsgs,
              tokenUsage: updatedTokenUsage,
              _tokenBaseline: updatedTokenUsage,
            });
            return { agents, agentLogLines: intLogLines };
          }

          // Keep streaming message and append the final result after it
          const streamId = event.taskId + "-stream";
          const streamMsg = agent.messages.find((m) => m.id === streamId);
          const durationMs = streamMsg ? Date.now() - streamMsg.timestamp : undefined;
          // Use the longest available text: accumulated stream > fullOutput > summary
          const accumulated = streamMsg?._accumulatedText ?? "";
          const serverFull = event.result.fullOutput || event.result.summary;
          const bestText = accumulated.length > serverFull.length ? accumulated : serverFull;
          // Detect solo agent presenting a [PLAN] or asking for user approval.
          const isSoloAgent = !agent.isTeamLead && !agent.teamId;
          const hasPlanAsk = isSoloAgent && /\[PLAN\]/i.test(bestText);
          // Detect approval requests: agent blocked by sandbox/hooks, or explicitly asking for permission.
          const hasApprovalAsk = isSoloAgent && !hasPlanAsk && /(?:需要.*(?:批准|审批|确认|允许)|(?:ask|need|request).*(?:approv|permiss|confirm)|before.*(?:proceed|continu)|destructive|请.*(?:手动|批准|确认)|sandbox.*(?:限制|restrict|block))/i.test(bestText);

          // Remove streaming message — final result (bestText) already contains the complete content
          const finalizedMessages = agent.messages.filter((m) => m.id !== streamId);
          const newMessages: ChatMessage[] = [
            ...finalizedMessages,
            {
              id: replyId,
              role: "agent",
              text: bestText,
              timestamp: Date.now(),
              result: event.result,
              isFinalResult: event.isFinalResult,
              durationMs,
            },
          ];
          const doneLogLines = new Map(state.agentLogLines);
          doneLogLines.delete(event.agentId);
          agents.set(event.agentId, {
            ...agent,
            status: "done",
            currentTaskId: null,
            awaitingApproval: hasPlanAsk || hasApprovalAsk,
            pendingApproval: null,
            lastLogLine: null,
            messages: newMessages,
            tokenUsage: updatedTokenUsage,
            _tokenBaseline: updatedTokenUsage,
          });
          saveToStorage(agents);
          notifyTaskDone(agent.name, bestText.slice(0, 200));
          return { agents, agentLogLines: doneLogLines };
        }
        case "TASK_FAILED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          const errorId = event.taskId + "-error";
          if (agent.messages.some((m) => m.id === errorId)) break; // dedupe
          const isCancelled = event.error === "Task cancelled by user";
          const displayText = isCancelled
            ? "Current task has been cancelled. Tell me continue to pick up where I left off, or start something entirely new."
            : event.error;
          // Finalize streaming message (keep it visible, stop updates)
          const failStreamId = event.taskId + "-stream";
          const finalizedMessages = agent.messages.map((m) =>
            m.id === failStreamId ? { ...m, id: failStreamId.replace("-stream", "-streamed") } : m
          );
          const failLogLines = new Map(state.agentLogLines);
          failLogLines.delete(event.agentId);
          agents.set(event.agentId, {
            ...agent,
            status: "error",
            currentTaskId: null,
            awaitingApproval: false,
            pendingApproval: null,
            lastLogLine: null,
            messages: [...finalizedMessages, {
              id: errorId,
              role: "system",
              text: displayText,
              timestamp: Date.now(),
            }],
          });
          saveToStorage(agents);
          return { agents, agentLogLines: failLogLines };
        }
        case "TASK_DELEGATED": {
          const fromAgent = agents.get(event.fromAgentId);
          const toAgent = agents.get(event.toAgentId);
          const delegateId = event.taskId + "-delegate";

          // Add system message to the source agent's chat (e.g. Marcus: "Delegated to Alex: ...")
          if (fromAgent && !fromAgent.messages.some((m) => m.id === delegateId)) {
            agents.set(event.fromAgentId, {
              ...fromAgent,
              messages: [...fromAgent.messages, {
                id: delegateId,
                role: "system",
                text: `Delegated to ${toAgent?.name ?? event.toAgentId}: ${event.prompt}`,
                timestamp: Date.now(),
              }],
            });
          }

          // Add incoming task message to the target agent's chat (e.g. Alex sees what Marcus asked)
          const receivedId = event.taskId + "-received";
          const targetAgent = agents.get(event.toAgentId) ?? defaultAgent(event.toAgentId);
          if (!targetAgent.messages.some((m) => m.id === receivedId)) {
            agents.set(event.toAgentId, {
              ...targetAgent,
              messages: [...targetAgent.messages, {
                id: receivedId,
                role: "user",
                text: `[From ${fromAgent?.name ?? event.fromAgentId}] ${event.prompt}`,
                timestamp: Date.now(),
              }],
            });
          }
          saveToStorage(agents);
          break;
        }
        case "LOG_APPEND": {
          const agent = agents.get(event.agentId);
          if (!agent || !event.chunk) break;
          // Update log line in separate map — avoids cloning agent object for status-only updates
          const logLines = new Map(state.agentLogLines);
          logLines.set(event.agentId, event.chunk);

          // Thinking snippets (💭 prefix) are status-only — update agentLogLines but skip chat
          if (event.chunk.startsWith("\uD83D\uDCAD ")) {
            return { agents: state.agents, agentLogLines: logLines };
          }

          // Update the streaming message — append new lines to build up output
          const streamId = agent.currentTaskId ? agent.currentTaskId + "-stream" : null;
          const lastMsg = agent.messages.length > 0 ? agent.messages[agent.messages.length - 1] : null;
          if (streamId && lastMsg?.id === streamId) {
            // Accumulate all output for full terminal-style display
            const prev = lastMsg._accumulatedText ?? "";
            const accumulated = prev ? prev + "\n" + event.chunk : event.chunk;
            const updatedMessages = [...agent.messages];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMsg,
              text: accumulated,
              timestamp: Date.now(),
              _accumulatedText: accumulated,
            };
            agents.set(event.agentId, { ...agent, messages: updatedMessages });
          }
          return { agents, agentLogLines: logLines };
        }
        case "TOOL_ACTIVITY": {
          const agent = agents.get(event.agentId);
          if (agent) {
            const toolLogLines = new Map(state.agentLogLines);
            toolLogLines.set(event.agentId, event.text);
            return { agents, agentLogLines: toolLogLines };
          }
          break;
        }
        case "TASK_RESULT_RETURNED": {
          // Add system message to originator's chat showing returned result
          const originator = agents.get(event.toAgentId);
          if (originator) {
            const fromAgent = agents.get(event.fromAgentId);
            const resultId = event.taskId + "-result-return";
            if (!originator.messages.some((m) => m.id === resultId)) {
              const statusWord = event.success ? "completed" : "failed";
              agents.set(event.toAgentId, {
                ...originator,
                messages: [...originator.messages, {
                  id: resultId,
                  role: "system",
                  text: `Result from ${fromAgent?.name ?? event.fromAgentId} (${statusWord}): ${event.summary.slice(0, 500)}`,
                  timestamp: Date.now(),
                }],
              });
            }
          }
          break;
        }
        case "TEAM_CHAT": {
          const fromAgent = agents.get(event.fromAgentId);
          const toAgent = event.toAgentId ? agents.get(event.toAgentId) : undefined;
          const teamMsg: TeamChatMessage = {
            id: `tc-${event.timestamp}-${event.fromAgentId}-${event.messageType}-${event.toAgentId ?? ""}`,
            fromAgentId: event.fromAgentId,
            fromAgentName: fromAgent?.name ?? event.fromAgentId,
            toAgentId: event.toAgentId,
            toAgentName: toAgent?.name ?? event.toAgentId,
            message: event.message,
            messageType: event.messageType,
            timestamp: event.timestamp,
          };
          if (state.teamMessages.some((m) => m.id === teamMsg.id)) break;
          const newTeamMessages = [...state.teamMessages, teamMsg];
          saveTeamMessages(newTeamMessages);
          // Warning messages: also inject into the agent's own console so solo agents see them
          if (event.messageType === "warning" && fromAgent) {
            const warnId = `warn-${event.timestamp}-${event.fromAgentId}`;
            if (!fromAgent.messages.some((m) => m.id === warnId)) {
              agents.set(event.fromAgentId, {
                ...fromAgent,
                messages: [...fromAgent.messages, {
                  id: warnId,
                  role: "system" as const,
                  text: event.message,
                  timestamp: event.timestamp,
                }],
              });
            }
          }
          return { agents, teamMessages: newTeamMessages };
        }
        case "TASK_QUEUED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          const queuedId = event.taskId + "-queued";
          if (!agent.messages.some((m) => m.id === queuedId)) {
            agents.set(event.agentId, {
              ...agent,
              messages: [...agent.messages, {
                id: queuedId,
                role: "system",
                text: `Task queued (position #${event.position}): ${event.prompt.slice(0, 100)}`,
                timestamp: Date.now(),
              }],
            });
          }
          break;
        }
        case "TOKEN_UPDATE": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          // Live per-task cumulative values — track baseline from completed tasks
          // so multi-task agents accumulate correctly
          const baseline = agent._tokenBaseline ?? { inputTokens: 0, outputTokens: 0 };
          agents.set(event.agentId, {
            ...agent,
            tokenUsage: {
              inputTokens: baseline.inputTokens + event.inputTokens,
              outputTokens: baseline.outputTokens + event.outputTokens,
            },
          });
          break;
        }
        case "AGENT_DEFS": {
          return { agents, agentDefs: event.agents };
        }
        case "SKILL_LIST": {
          return { agents, availableSkills: event.skills };
        }
        case "CHAT_HISTORY_LOADED": {
          // Restore messages from gateway-side persistence (when localStorage is empty)
          try {
            const saved: PersistedAgent[] = JSON.parse(event.data);
            for (const item of saved) {
              const agent = agents.get(item.agentId);
              if (agent && agent.messages.length === 0 && item.messages.length > 0) {
                agent.messages = filterRecentMessages(item.messages);
              }
            }
          } catch { /* malformed data */ }
          return { agents };
        }
        case "TEAM_PHASE": {
          const teamPhases = new Map(state.teamPhases);
          teamPhases.set(event.teamId, { phase: event.phase, leadAgentId: event.leadAgentId });
          saveTeamPhases(teamPhases);
          return { agents, teamPhases, pendingTeamProjectId: null };
        }
        case "SUGGESTION": {
          const newSuggestions = [...state.suggestions, { text: event.text, author: event.author, timestamp: event.timestamp }];
          // Cap at 50
          if (newSuggestions.length > 50) newSuggestions.shift();
          return { agents, suggestions: newSuggestions };
        }
        case "PREVIEW_READY": {
          return { agents, pendingPreviewUrl: tunnelRewrite(event.url) };
        }
        case "FOLDER_PICKED": {
          const cb = folderPickCallbacks.get(event.requestId);
          if (cb) {
            cb(event.path);
            folderPickCallbacks.delete(event.requestId);
          }
          return { agents };
        }
        case "IMAGE_UPLOADED": {
          const cb = imageUploadCallbacks.get(event.requestId);
          if (cb) {
            cb(event.path);
            imageUploadCallbacks.delete(event.requestId);
          }
          return { agents };
        }
        case "BACKENDS_AVAILABLE": {
          return { agents, detectedBackends: event.backends };
        }
        case "CONFIG_LOADED": {
          return { agents, configData: { telegramBotToken: event.telegramBotToken, telegramAllowedUsers: event.telegramAllowedUsers, telegramConnected: event.telegramConnected, worktreeEnabled: event.worktreeEnabled, autoMergeEnabled: event.autoMergeEnabled, tunnelBaseUrl: event.tunnelBaseUrl, tunnelToken: event.tunnelToken, tunnelRunning: event.tunnelRunning } };
        }
        case "CONFIG_SAVED": {
          return { agents, configResult: { success: event.success, message: event.message, telegramConnected: event.telegramConnected, tunnelRunning: event.tunnelRunning } };
        }
        case "PROJECT_LIST": {
          return { agents, projectList: event.projects };
        }
        case "WORKTREE_READY": {
          const agent = agents.get(event.agentId);
          if (agent) agents.set(event.agentId, { ...agent, pendingMerge: true });
          break;
        }
        case "WORKTREE_MERGED": {
          console.log(`[Store DEBUG] WORKTREE_MERGED: agentId=${event.agentId} success=${event.success} commitHash=${event.commitHash} commitMessage=${event.commitMessage}`);
          const agent = agents.get(event.agentId);
          if (agent) agents.set(event.agentId, {
            ...agent,
            pendingMerge: event.success ? false : agent.pendingMerge,
            lastMergeCommit: event.success ? (event.commitHash ?? agent.lastMergeCommit) : agent.lastMergeCommit,
            lastMergeMessage: event.success ? (event.commitMessage ?? agent.lastMergeMessage) : agent.lastMergeMessage,
            undoCount: event.undoCount ?? (event.success ? (agent.undoCount ?? 0) + 1 : agent.undoCount),
          });
          break;
        }
        case "WORKTREE_REVERTED": {
          const agent = agents.get(event.agentId);
          if (agent && event.commitsAhead === 0) {
            agents.set(event.agentId, { ...agent, pendingMerge: false });
          }
          break;
        }
        case "AUTO_MERGE_UPDATED": {
          const agent = agents.get(event.agentId);
          if (agent) agents.set(event.agentId, {
            ...agent,
            autoMerge: event.autoMerge,
            lastMergeCommit: event.lastMergeCommit !== undefined ? event.lastMergeCommit : agent.lastMergeCommit,
            lastMergeMessage: event.lastMergeMessage !== undefined ? event.lastMergeMessage : agent.lastMergeMessage,
            undoCount: event.undoCount ?? agent.undoCount,
          });
          break;
        }
        case "PROJECT_DATA": {
          return {
            agents,
            viewingProjectId: event.projectId,
            viewingProjectName: event.name,
            viewingProjectEvents: event.events as GatewayEvent[],
          };
        }
      }

      return { agents };
    });
  },
}));
