// ---------------------------------------------------------------------------
// @bit-office/memory — File-based storage layer
//
// All data lives under a configurable root directory (default ~/.bit-office/memory/).
// Layout:
//   {root}/memory.json              — legacy project-level memory
//   {root}/sessions/{agentId}.json  — L1 session history per agent
//   {root}/agents/{agentId}.json    — L2 agent facts per agent
//   {root}/shared.json              — L3 cross-agent knowledge
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { homedir } from "os";

import type {
  SessionHistoryStore,
  AgentFactStore,
  SharedKnowledgeStore,
  LegacyMemoryStore,
} from "./types.js";

/* ── Configurable root ──────────────────────────────────────────────────── */

let _root = path.join(homedir(), ".bit-office", "memory");

/** Override the storage root directory (call before any read/write). */
export function setStorageRoot(dir: string): void {
  _root = dir;
}

/** Get current storage root (for debugging/testing). */
export function getStorageRoot(): string {
  return _root;
}

/* ── Generic JSON persistence ───────────────────────────────────────────── */

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    }
  } catch {
    /* corrupt file — return fallback */
  }
  return fallback;
}

function writeJSON(filePath: string, data: unknown): void {
  ensureDir(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/* ── Path helpers ───────────────────────────────────────────────────────── */

function sessionPath(agentId: string): string {
  return path.join(_root, "sessions", `${agentId}.json`);
}

function agentFactPath(agentId: string): string {
  return path.join(_root, "agents", `${agentId}.json`);
}

function sharedPath(): string {
  return path.join(_root, "shared.json");
}

function legacyPath(): string {
  return path.join(_root, "memory.json");
}

/* ── L1: Session History ────────────────────────────────────────────────── */

function emptySessionStore(): SessionHistoryStore {
  return { latest: null, history: [] };
}

export function loadSessionHistory(agentId: string): SessionHistoryStore {
  return readJSON(sessionPath(agentId), emptySessionStore());
}

export function saveSessionHistory(agentId: string, store: SessionHistoryStore): void {
  writeJSON(sessionPath(agentId), store);
}

/* ── L2: Agent Facts ────────────────────────────────────────────────────── */

function emptyFactStore(agentId: string): AgentFactStore {
  return { agentId, facts: [] };
}

export function loadAgentFacts(agentId: string): AgentFactStore {
  return readJSON(agentFactPath(agentId), emptyFactStore(agentId));
}

export function saveAgentFacts(agentId: string, store: AgentFactStore): void {
  writeJSON(agentFactPath(agentId), store);
}

/* ── L3: Shared Knowledge ───────────────────────────────────────────────── */

function emptyShared(): SharedKnowledgeStore {
  return { items: [] };
}

export function loadSharedKnowledge(): SharedKnowledgeStore {
  return readJSON(sharedPath(), emptyShared());
}

export function saveSharedKnowledge(store: SharedKnowledgeStore): void {
  writeJSON(sharedPath(), store);
}

/* ── Legacy: Project-level memory (backward compat) ─────────────────────── */

function emptyLegacy(): LegacyMemoryStore {
  return { reviewPatterns: [], techPreferences: [], projectHistory: [] };
}

export function loadLegacyMemory(): LegacyMemoryStore {
  return readJSON(legacyPath(), emptyLegacy());
}

export function saveLegacyMemory(store: LegacyMemoryStore): void {
  writeJSON(legacyPath(), store);
}
