/**
 * Persist team state to disk so gateway restarts don't lose agents/team/phase.
 * File: ~/.open-office[-dev]/data/instances/{id}/team-state.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, readdirSync } from "fs";
import path from "path";
import type { GatewayEvent } from "@office/shared";
import { config, CONFIG_DIR } from "./config.js";
// Project history dir is shared (archives are instance-agnostic)
const PROJECTS_DIR = path.join(CONFIG_DIR, "data", "project-history");

// Instance-scoped state files — isolates Tauri / Web / CLI gateway instances
function getStateFile(): string { return path.join(config.instanceDir, "team-state.json"); }
function getEventsFile(): string { return path.join(config.instanceDir, "project-events.jsonl"); }

export interface PersistedAgent {
  agentId: string;
  name: string;
  role: string;
  personality?: string;
  backend?: string;
  model?: string;
  palette?: number;
  teamId?: string;
  isTeamLead?: boolean;
  workDir?: string;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  autoMerge?: boolean;
  canDelegate?: boolean;
  noCode?: boolean;
}

export interface PersistedTeam {
  teamId: string;
  leadAgentId: string;
  phase: "create" | "design" | "execute" | "complete";
  projectDir: string | null;
  /** Leader's originalTask (approved plan / project context) — survives restart */
  originalTask?: string | null;
}

export interface TeamState {
  agents: PersistedAgent[];
  team: PersistedTeam | null;
}

const EMPTY_STATE: TeamState = { agents: [], team: null };

export function loadTeamState(): TeamState {
  try {
    if (existsSync(getStateFile())) {
      const raw = JSON.parse(readFileSync(getStateFile(), "utf-8"));
      if (raw && Array.isArray(raw.agents)) {
        return raw as TeamState;
      }
    }
  } catch { /* corrupt file, start fresh */ }
  return { ...EMPTY_STATE, agents: [] };
}

export function saveTeamState(state: TeamState): void {
  try {
    const file = getStateFile();
    const dir = path.dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Atomic write: tmp file + rename to prevent truncation on kill
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, file);
  } catch (e) {
    console.log(`[TeamState] Failed to save: ${e}`);
  }
}

export function clearTeamState(): void {
  saveTeamState({ agents: [], team: null });
}

// ---------------------------------------------------------------------------
// Project history — archive completed projects for later review
// ---------------------------------------------------------------------------

export interface ProjectPreview {
  entryFile?: string;
  projectDir?: string;
  previewCmd?: string;
  previewPort?: number;
}

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

export type ProjectRatings = Record<string, number>;

export interface ProjectArchive {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  agents: PersistedAgent[];
  team: PersistedTeam | null;
  events: GatewayEvent[];
  preview?: ProjectPreview;
  tokenUsage?: TokenUsageSummary;
  ratings?: ProjectRatings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  agentNames: string[];
  eventCount: number;
  preview?: ProjectPreview;
  tokenUsage?: TokenUsageSummary;
  ratings?: ProjectRatings;
}

/** In-memory event buffer for the current project */
let projectEvents: GatewayEvent[] = [];
let projectStartedAt: number = Date.now();
let projectName: string = "";

/** Metadata header stored as the first line of the JSONL file */
interface EventsFileHeader {
  _header: true;
  startedAt: number;
  projectName: string;
}

export function setProjectName(name: string): void {
  projectName = name;
  // Update header on disk
  rewriteEventsFile();
}

export function resetProjectBuffer(): void {
  projectEvents = [];
  projectStartedAt = Date.now();
  projectName = "";
  // Truncate the on-disk buffer
  try { writeFileSync(getEventsFile(), "", "utf-8"); } catch { /* ignore */ }
}

/**
 * Restore project event buffer from disk (call on startup).
 * Survives gateway restarts so archiveProject has data.
 */
export function loadProjectBuffer(): void {
  try {
    if (!existsSync(getEventsFile())) return;
    const raw = readFileSync(getEventsFile(), "utf-8").trim();
    if (!raw) return;
    const lines = raw.split("\n");
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj._header) {
          projectStartedAt = obj.startedAt ?? Date.now();
          projectName = obj.projectName ?? "";
        } else {
          projectEvents.push(obj as GatewayEvent);
        }
      } catch { /* skip corrupt line */ }
    }
    if (projectEvents.length > 0) {
      console.log(`[TeamState] Restored ${projectEvents.length} buffered project events from disk`);
    }
  } catch { /* ignore */ }
}

const MAX_PROJECT_EVENTS = 5000;

export function bufferEvent(event: GatewayEvent): void {
  if (projectEvents.length >= MAX_PROJECT_EVENTS) return;
  // Ensure every archived event has a timestamp
  const stamped = ("timestamp" in event && event.timestamp) ? event : { ...event, timestamp: Date.now() };
  projectEvents.push(stamped as GatewayEvent);
  // Append to disk (one JSON line) — survives gateway restart
  try {
    const dir = path.dirname(getEventsFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(getEventsFile(), JSON.stringify(stamped) + "\n", "utf-8");
  } catch { /* best-effort */ }
}

/** Rewrite the full JSONL file (used when header metadata changes, e.g. projectName) */
function rewriteEventsFile(): void {
  try {
    const dir = path.dirname(getEventsFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const header: EventsFileHeader = { _header: true, startedAt: projectStartedAt, projectName };
    const lines = [JSON.stringify(header), ...projectEvents.map(e => JSON.stringify(e))];
    writeFileSync(getEventsFile(), lines.join("\n") + "\n", "utf-8");
  } catch { /* best-effort */ }
}

export function archiveProject(agents: PersistedAgent[], team: PersistedTeam | null): string | null {
  // Don't archive empty projects (no meaningful events)
  const meaningful = projectEvents.filter(e =>
    e.type === "TASK_DONE" || e.type === "TEAM_CHAT" || e.type === "TASK_STARTED"
  );
  if (meaningful.length === 0) return null;

  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });

  // Extract preview info from the last TASK_DONE with isFinalResult or any preview fields
  let preview: ProjectPreview | undefined;
  for (let i = projectEvents.length - 1; i >= 0; i--) {
    const e = projectEvents[i];
    if (e.type === "TASK_DONE" && e.result) {
      const r = e.result;
      if (r.entryFile || r.previewCmd || r.previewPath) {
        preview = {
          entryFile: r.entryFile,
          projectDir: r.projectDir ?? team?.projectDir ?? undefined,
          previewCmd: r.previewCmd,
          previewPort: r.previewPort,
        };
        break;
      }
    }
  }

  // Aggregate token usage from all TASK_DONE events
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCostUsd = 0;
  for (const e of projectEvents) {
    if (e.type === "TASK_DONE" && e.result?.tokenUsage) {
      totalInputTokens += e.result.tokenUsage.inputTokens ?? 0;
      totalOutputTokens += e.result.tokenUsage.outputTokens ?? 0;
      totalCacheRead += e.result.tokenUsage.cacheReadTokens ?? 0;
      totalCacheWrite += e.result.tokenUsage.cacheWriteTokens ?? 0;
      totalCostUsd += e.result.tokenUsage.costUsd ?? 0;
    }
  }
  const tokenUsage: TokenUsageSummary | undefined =
    (totalInputTokens > 0 || totalOutputTokens > 0)
      ? {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheRead || undefined,
          cacheWriteTokens: totalCacheWrite || undefined,
          costUsd: totalCostUsd || undefined,
        }
      : undefined;

  const id = `${projectStartedAt}-${projectName || "project"}`;

  // Preserve ratings from existing archive (user may have rated before END_PROJECT)
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  let existingRatings: ProjectRatings | undefined;
  try {
    if (existsSync(filePath)) {
      const existing = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectArchive;
      existingRatings = existing.ratings;
    }
  } catch { /* ignore corrupt file */ }

  const archive: ProjectArchive = {
    id,
    name: projectName || "Untitled Project",
    startedAt: projectStartedAt,
    endedAt: Date.now(),
    agents,
    team,
    events: projectEvents,
    preview,
    tokenUsage,
    ratings: existingRatings,
  };

  try {
    writeFileSync(filePath, JSON.stringify(archive), "utf-8");
    console.log(`[TeamState] Archived project "${archive.name}" (${projectEvents.length} events) → ${filePath}`);
    return id;
  } catch (e) {
    console.log(`[TeamState] Failed to archive project: ${e}`);
    return null;
  }
}

const MAX_LISTED_PROJECTS = 50;

export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  try {
    const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, MAX_LISTED_PROJECTS);
    const summaries: ProjectSummary[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(path.join(PROJECTS_DIR, file), "utf-8")) as ProjectArchive;
        summaries.push({
          id: raw.id,
          name: raw.name,
          startedAt: raw.startedAt,
          endedAt: raw.endedAt,
          agentNames: raw.agents.map(a => a.name),
          eventCount: raw.events.length,
          preview: raw.preview,
          tokenUsage: raw.tokenUsage,
          ratings: raw.ratings,
        });
      } catch { /* skip corrupt files */ }
    }
    return summaries;
  } catch { return []; }
}

export function loadProject(id: string): ProjectArchive | null {
  // Sanitize: strip path separators to prevent path traversal
  const safeId = id.replace(/[/\\]/g, "");
  if (!safeId) return null;
  const filePath = path.join(PROJECTS_DIR, `${safeId}.json`);
  // Ensure resolved path is still inside PROJECTS_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(PROJECTS_DIR))) return null;
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectArchive;
    }
  } catch { /* corrupt */ }
  return null;
}

/** Rate a project archive by ID, or the most recent one if no ID given */
export function rateProject(ratings: ProjectRatings, projectId?: string): boolean {
  if (!existsSync(PROJECTS_DIR)) return false;
  try {
    let filePath: string;
    if (projectId) {
      const safeId = projectId.replace(/[/\\]/g, "");
      filePath = path.join(PROJECTS_DIR, `${safeId}.json`);
      if (!path.resolve(filePath).startsWith(path.resolve(PROJECTS_DIR))) return false;
    } else {
      const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json")).sort().reverse();
      if (files.length === 0) return false;
      filePath = path.join(PROJECTS_DIR, files[0]);
    }
    if (!existsSync(filePath)) return false;
    const archive = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectArchive;
    archive.ratings = ratings;
    writeFileSync(filePath, JSON.stringify(archive), "utf-8");
    console.log(`[TeamState] Rated project "${archive.name}":`, ratings);
    return true;
  } catch (e) {
    console.log(`[TeamState] Failed to rate project: ${e}`);
    return false;
  }
}
