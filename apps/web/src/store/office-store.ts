import { create } from "zustand";
import type { AgentStatus, GatewayEvent, TaskResultPayload, AgentDefinition, UserRole } from "@office/shared";

/** Pending PICK_FOLDER callbacks: requestId → callback */
export const folderPickCallbacks = new Map<string, (path: string) => void>();
/** Pending UPLOAD_IMAGE callbacks: requestId → callback */
export const imageUploadCallbacks = new Map<string, (path: string) => void>();

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
}

export interface TeamChatMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId?: string;
  toAgentName?: string;
  message: string;
  messageType: "delegation" | "result" | "status";
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
  projectList: ProjectSummary[];
  viewingProjectId: string | null;
  viewingProjectEvents: GatewayEvent[];
  viewingProjectName: string | null;
  pendingPreviewUrl: string | null;
  connected: boolean;
  hydrated: boolean;
  consumePreviewUrl: () => string | null;
  setConnected: (c: boolean) => void;
  setRole: (role: UserRole) => void;
  hydrate: () => void;
  handleEvent: (event: GatewayEvent) => void;
  getAgent: (id: string) => AgentState;
  addUserMessage: (agentId: string, taskId: string, prompt: string) => void;
  removeAgent: (agentId: string) => void;
  clearTeamMessages: () => void;
  clearViewingProject: () => void;
}

// ── localStorage persistence ──

const STORAGE_KEY = "office-chat-history";

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

function saveToStorage(agents: Map<string, AgentState>) {
  if (!isBrowser()) return;
  try {
    const data: PersistedAgent[] = [];
    for (const [, agent] of agents) {
      // Skip external agents — they are transient
      if (agent.isExternal) continue;
      if (agent.messages.length > 0 || agent.name !== agent.agentId) {
        data.push({
          agentId: agent.agentId,
          name: agent.name,
          role: agent.role,
          palette: agent.palette,
          personality: agent.personality,
          backend: agent.backend,
          isTeamLead: agent.isTeamLead,
          teamId: agent.teamId,
          messages: agent.messages,
        });
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded or unavailable
  }
}

function loadFromStorage(): Map<string, PersistedAgent> {
  if (!isBrowser()) return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const data: PersistedAgent[] = JSON.parse(raw);
    const map = new Map<string, PersistedAgent>();
    for (const item of data) {
      map.set(item.agentId, item);
    }
    return map;
  } catch {
    return new Map();
  }
}

function removeFromStorage(agentId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: PersistedAgent[] = JSON.parse(raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.filter(a => a.agentId !== agentId)));
  } catch {
    // ignore
  }
}

// ── Team messages persistence ──

const TEAM_STORAGE_KEY = "office-team-messages";

function saveTeamMessages(messages: TeamChatMessage[]) {
  if (!isBrowser()) return;
  try {
    // Keep last 200 messages
    const trimmed = messages.slice(-200);
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

function loadTeamMessages(): TeamChatMessage[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(TEAM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Team phase persistence ──

const TEAM_PHASE_KEY = "office-team-phase";

function saveTeamPhases(phases: Map<string, TeamPhaseState>) {
  if (!isBrowser()) return;
  try {
    const data: Record<string, TeamPhaseState> = {};
    for (const [k, v] of phases) data[k] = v;
    localStorage.setItem(TEAM_PHASE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function loadTeamPhases(): Map<string, TeamPhaseState> {
  if (!isBrowser()) return new Map();
  try {
    const raw = localStorage.getItem(TEAM_PHASE_KEY);
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
  projectList: [],
  viewingProjectId: null,
  viewingProjectEvents: [],
  viewingProjectName: null,
  pendingPreviewUrl: null,
  connected: false,
  hydrated: false,

  consumePreviewUrl: () => {
    const url = get().pendingPreviewUrl;
    if (url) set({ pendingPreviewUrl: null });
    return url;
  },
  setConnected: (c) => set({ connected: c }),
  setRole: (role) => set({ role }),

  hydrate: () => {
    if (get().hydrated) return;
    const saved = loadFromStorage();
    const savedTeamMessages = loadTeamMessages();
    const savedTeamPhases = loadTeamPhases();
    if (saved.size === 0 && savedTeamMessages.length === 0 && savedTeamPhases.size === 0) { set({ hydrated: true, teamMessages: savedTeamMessages, teamPhases: savedTeamPhases }); return; }
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
      return { agents, teamMessages: savedTeamMessages, teamPhases: savedTeamPhases, hydrated: true };
    });
  },

  getAgent: (id) => {
    return get().agents.get(id) ?? defaultAgent(id);
  },

  removeAgent: (agentId) => {
    set((state) => {
      const agents = new Map(state.agents);
      agents.delete(agentId);
      removeFromStorage(agentId);
      return { agents };
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
              startedAt: event.startedAt ?? existing.startedAt,
            });
          } else {
            // Restore saved messages from localStorage (skip for external agents)
            const saved = event.isExternal ? undefined : loadFromStorage().get(event.agentId);
            const agent = defaultAgent(event.agentId, event.name, event.role);
            agent.palette = event.palette ?? saved?.palette;
            agent.personality = event.personality ?? saved?.personality;
            agent.backend = event.backend ?? saved?.backend;
            agent.isTeamLead = event.isTeamLead ?? saved?.isTeamLead;
            agent.teamId = event.teamId ?? saved?.teamId;
            agent.isExternal = event.isExternal;
            agent.pid = event.pid;
            agent.cwd = event.cwd;
            agent.startedAt = event.startedAt;
            if (saved) {
              agent.messages = saved.messages;
            }
            agents.set(event.agentId, agent);
          }
          // Skip localStorage persistence for external agents
          if (!event.isExternal) {
            // Debug: detect isTeamLead loss
            const updated = agents.get(event.agentId);
            if (existing?.isTeamLead && !updated?.isTeamLead) {
              console.warn(`[Store] isTeamLead LOST for ${event.agentId}! event.isTeamLead=${event.isTeamLead}, existing=${existing.isTeamLead}`);
              console.trace();
            }
            saveToStorage(agents);
          }
          break;
        }
        case "AGENT_FIRED": {
          agents.delete(event.agentId);
          removeFromStorage(event.agentId);
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
          // Also clean up any stale streaming messages from previous tasks
          const streamId = event.taskId + "-stream";
          const hasStream = agent.messages.some((m) => m.id === streamId);
          const cleanedMsgs = agent.messages.filter((m) => !m.id.endsWith("-stream") || m.id === streamId);
          agents.set(event.agentId, {
            ...agent,
            status: "working",
            currentTaskId: event.taskId,
            currentPrompt: event.prompt,
            pendingApproval: null,
            lastLogLine: null,
            messages: hasStream ? cleanedMsgs : [...cleanedMsgs, {
              id: streamId,
              role: "agent" as const,
              text: "",
              timestamp: Date.now(),
            }],
          });
          break;
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
            // Clean up streaming message for this intermediate task
            const intStreamId = event.taskId + "-stream";
            const intCleanedMsgs = agent.messages.filter((m) => m.id !== intStreamId);
            agents.set(event.agentId, {
              ...agent,
              status: "working",
              currentTaskId: null,
              pendingApproval: null,
              lastLogLine: event.result.summary?.slice(0, 100) ?? "Coordinating team...",
              messages: intCleanedMsgs,
              tokenUsage: updatedTokenUsage,
              _tokenBaseline: updatedTokenUsage,
            });
            break;
          }

          // Replace streaming message with final result, or append if no stream
          const streamId = event.taskId + "-stream";
          const streamMsg = agent.messages.find((m) => m.id === streamId);
          const durationMs = streamMsg ? Date.now() - streamMsg.timestamp : undefined;
          // Use the longest available text: accumulated stream > fullOutput > summary
          const accumulated = streamMsg?._accumulatedText ?? "";
          const serverFull = event.result.fullOutput || event.result.summary;
          const bestText = accumulated.length > serverFull.length ? accumulated : serverFull;
          const filteredMessages = agent.messages.filter((m) => m.id !== streamId);
          const newMessages: ChatMessage[] = [
            ...filteredMessages,
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
          agents.set(event.agentId, {
            ...agent,
            status: "done",
            currentTaskId: null,
            pendingApproval: null,
            lastLogLine: null,
            messages: newMessages,
            tokenUsage: updatedTokenUsage,
            _tokenBaseline: updatedTokenUsage,
          });
          saveToStorage(agents);
          break;
        }
        case "TASK_FAILED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          const errorId = event.taskId + "-error";
          if (agent.messages.some((m) => m.id === errorId)) break; // dedupe
          const isCancelled = event.error === "Task cancelled by user";
          const displayText = isCancelled
            ? "Current task has been cancelled. Tell me continue to pick up where I left off, or start something entirely new."
            : event.error;
          // Remove streaming message for this task
          const failStreamId = event.taskId + "-stream";
          const cleanedMessages = agent.messages.filter((m) => m.id !== failStreamId);
          agents.set(event.agentId, {
            ...agent,
            status: "error",
            currentTaskId: null,
            pendingApproval: null,
            lastLogLine: null,
            messages: [...cleanedMessages, {
              id: errorId,
              role: "system",
              text: displayText,
              timestamp: Date.now(),
            }],
          });
          saveToStorage(agents);
          break;
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
          agents.set(event.agentId, { ...agent, lastLogLine: event.chunk });

          // Update the streaming message — append new lines to build up output
          const streamId = agent.currentTaskId ? agent.currentTaskId + "-stream" : null;
          const lastMsg = agent.messages.length > 0 ? agent.messages[agent.messages.length - 1] : null;
          if (streamId && lastMsg?.id === streamId) {
            // Show latest chunk as streaming preview + always append to accumulated
            const prev = lastMsg._accumulatedText ?? "";
            const accumulated = prev ? prev + "\n" + event.chunk : event.chunk;
            const updatedMessages = [...agent.messages];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMsg,
              text: event.chunk,
              timestamp: Date.now(),
              _accumulatedText: accumulated,
            };
            agents.set(event.agentId, { ...agents.get(event.agentId)!, messages: updatedMessages });
          } else if (agent.isExternal) {
            // External agents: accumulate text into the latest agent message (no task:done to replace)
            const now = Date.now();
            if (lastMsg && lastMsg.role === "agent" && (now - lastMsg.timestamp) < 10000) {
              // Append new content to existing message
              const prev = lastMsg.text;
              const newText = prev ? prev + "\n" + event.chunk : event.chunk;
              const updatedMessages = [...agent.messages];
              updatedMessages[updatedMessages.length - 1] = { ...lastMsg, text: newText, timestamp: now };
              agents.set(event.agentId, { ...agents.get(event.agentId)!, messages: updatedMessages });
            } else {
              // New message block (gap > 10 seconds = new "turn")
              agents.set(event.agentId, {
                ...agents.get(event.agentId)!,
                messages: [...agents.get(event.agentId)!.messages, { id: `ext-log-${now}`, role: "agent", text: event.chunk, timestamp: now }],
              });
            }
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
        case "TEAM_PHASE": {
          const teamPhases = new Map(state.teamPhases);
          teamPhases.set(event.teamId, { phase: event.phase, leadAgentId: event.leadAgentId });
          saveTeamPhases(teamPhases);
          return { agents, teamPhases };
        }
        case "SUGGESTION": {
          const newSuggestions = [...state.suggestions, { text: event.text, author: event.author, timestamp: event.timestamp }];
          // Cap at 50
          if (newSuggestions.length > 50) newSuggestions.shift();
          return { agents, suggestions: newSuggestions };
        }
        case "PREVIEW_READY": {
          return { agents, pendingPreviewUrl: event.url };
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
        case "PROJECT_LIST": {
          return { agents, projectList: event.projects };
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
