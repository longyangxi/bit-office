import { create } from "zustand";
import type { AgentStatus, GatewayEvent, TaskResultPayload } from "@office/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  timestamp: number;
  result?: TaskResultPayload;
  isFinalResult?: boolean;
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

interface OfficeStore {
  agents: Map<string, AgentState>;
  teamMessages: TeamChatMessage[];
  connected: boolean;
  hydrated: boolean;
  setConnected: (c: boolean) => void;
  hydrate: () => void;
  handleEvent: (event: GatewayEvent) => void;
  getAgent: (id: string) => AgentState;
  addUserMessage: (agentId: string, taskId: string, prompt: string) => void;
  removeAgent: (agentId: string) => void;
  clearTeamMessages: () => void;
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
  };
}

export const useOfficeStore = create<OfficeStore>((set, get) => ({
  agents: new Map(),
  teamMessages: [],
  connected: false,
  hydrated: false,

  setConnected: (c) => set({ connected: c }),

  hydrate: () => {
    if (get().hydrated) return;
    const saved = loadFromStorage();
    const savedTeamMessages = loadTeamMessages();
    if (saved.size === 0 && savedTeamMessages.length === 0) { set({ hydrated: true, teamMessages: savedTeamMessages }); return; }
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
      return { agents, teamMessages: savedTeamMessages, hydrated: true };
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
    set({ teamMessages: [] });
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
            saveToStorage(agents);
          }
          break;
        }
        case "AGENT_FIRED": {
          agents.delete(event.agentId);
          removeFromStorage(event.agentId);
          break;
        }
        case "AGENT_STATUS": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          // Guard: ignore all server-side idle downgrades; rely on TASK_DONE/TASK_FAILED events instead
          if (event.status === "idle" && agent.status !== "idle") {
            break;
          }
          agents.set(event.agentId, { ...agent, status: event.status });
          break;
        }
        case "TASK_STARTED": {
          const agent = agents.get(event.agentId) ?? defaultAgent(event.agentId);
          agents.set(event.agentId, {
            ...agent,
            status: "working",
            currentTaskId: event.taskId,
            currentPrompt: event.prompt,
            pendingApproval: null,
            lastLogLine: null,
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

          // Team lead intermediate completions (delegating, processing results)
          // should not appear as chat messages — only the final summary matters
          if (agent.isTeamLead && !event.isFinalResult) {
            agents.set(event.agentId, {
              ...agent,
              status: "working",
              currentTaskId: null,
              pendingApproval: null,
              lastLogLine: event.result.summary?.slice(0, 100) ?? "Coordinating team...",
            });
            break;
          }

          const newMessages: ChatMessage[] = [
            ...agent.messages,
            {
              id: replyId,
              role: "agent",
              text: event.result.summary,
              timestamp: Date.now(),
              result: event.result,
              isFinalResult: event.isFinalResult,
            },
          ];
          agents.set(event.agentId, {
            ...agent,
            status: "done",
            currentTaskId: null,
            pendingApproval: null,
            lastLogLine: null,
            messages: newMessages,
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
          agents.set(event.agentId, {
            ...agent,
            status: "error",
            currentTaskId: null,
            pendingApproval: null,
            lastLogLine: null,
            messages: [...agent.messages, {
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
          if (agent) {
            agents.set(event.agentId, { ...agent, lastLogLine: event.chunk });

            // For external agents, also append as read-only chat messages
            if (agent.isExternal && event.chunk) {
              const now = Date.now();
              const lastMsg = agent.messages.length > 0 ? agent.messages[agent.messages.length - 1] : null;
              // Throttle: update last agent message if within 3 seconds
              if (lastMsg && lastMsg.role === "agent" && (now - lastMsg.timestamp) < 3000) {
                const updatedMessages = [...agent.messages];
                updatedMessages[updatedMessages.length - 1] = {
                  ...lastMsg,
                  text: event.chunk,
                  timestamp: now,
                };
                agents.set(event.agentId, { ...agents.get(event.agentId)!, messages: updatedMessages });
              } else {
                const msgId = `ext-log-${now}`;
                agents.set(event.agentId, {
                  ...agents.get(event.agentId)!,
                  messages: [...agents.get(event.agentId)!.messages, {
                    id: msgId,
                    role: "agent",
                    text: event.chunk,
                    timestamp: now,
                  }],
                });
              }
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
      }

      return { agents };
    });
  },
}));
