/**
 * recap-data.ts — Two paths to build RecapData:
 *
 * 1. LIVE PATH (preferred): RecapCollector — O(1) per event, records only
 *    key data points during project execution. Zero rendering cost.
 *    Call collector.toRecapData() when user clicks "Share Recap".
 *
 * 2. ARCHIVE PATH (fallback): extractRecapData() — post-hoc extraction
 *    from a stored ProjectArchive. Used for historical projects that
 *    weren't tracked live.
 *
 * This module is the ONLY coupling point with the existing system.
 */

// ---- Types ----

export interface RecapAgent {
  name: string;
  role: string;       // "dev" | "reviewer" | "leader" | free-form
  palette?: number;
}

export interface RecapReviewRound {
  round: number;
  verdict: "pass" | "fail" | "unknown";
  /** First ~120 chars of reviewer comment */
  snippet: string;
}

export interface MilestoneEntry {
  type: "start" | "coding" | "review" | "fix" | "pass" | "done";
  agentName: string;
  timestamp: number;
  label: string;
}

export interface RecapData {
  projectName: string;
  agents: RecapAgent[];

  // Timing
  startedAt: number;      // epoch ms
  endedAt: number;
  durationSec: number;

  // Code stats
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  diffStat: string;

  // AI stats
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;

  // Reviews
  reviewRounds: RecapReviewRound[];
  finalVerdict: "pass" | "fail" | "unknown";

  // Test
  testResult: "passed" | "failed" | "unknown";

  // Key moments
  milestones: MilestoneEntry[];
}

// =====================================================================
// PATH 1: Live Collector — use during project execution
// =====================================================================

/**
 * Lightweight data-point recorder. Feed it events as they arrive;
 * it stores only the handful of fields needed for the recap.
 * Cost per event: one switch + at most a few property reads.
 * Memory: O(agents + review rounds + milestones) ≈ < 1KB typical.
 *
 * Usage:
 *   const collector = new RecapCollector("My Project");
 *   // In your event handler:
 *   collector.onEvent(event);
 *   // When user clicks share:
 *   const data = collector.toRecapData();
 */
export class RecapCollector {
  private projectName: string;
  private agents = new Map<string, RecapAgent>(); // agentId → agent
  private agentNames = new Map<string, string>();  // agentId → name
  private startedAt = 0;
  private endedAt = 0;

  // Accumulated stats (updated incrementally)
  private filesChanged = 0;
  private linesAdded = 0;
  private linesRemoved = 0;
  private diffStat = "";
  private testResult: "passed" | "failed" | "unknown" = "unknown";
  private inputTokens = 0;
  private outputTokens = 0;

  private reviewRounds: RecapReviewRound[] = [];
  private reviewCount = 0;
  private milestones: MilestoneEntry[] = [];

  constructor(projectName: string) {
    this.projectName = projectName;
  }

  /** Register an agent. Call once per agent when hired / created. */
  addAgent(agentId: string, name: string, role: string, palette?: number) {
    this.agents.set(agentId, { name, role: normalizeRole(role), palette });
    this.agentNames.set(agentId, name);
  }

  /** Feed a gateway event. Only relevant types are processed; rest are ignored. */
  onEvent(ev: { type: string; [k: string]: unknown }) {
    const now = Date.now();

    switch (ev.type) {
      case "TASK_STARTED": {
        if (!this.startedAt) this.startedAt = now;
        const name = this.getName(ev.agentId as string);
        this.milestones.push({ type: "start", agentName: name, timestamp: now, label: "Task started" });
        break;
      }

      case "TASK_DONE": {
        this.endedAt = now;
        const agentId = ev.agentId as string;
        const name = this.getName(agentId);
        const result = ev.result as Record<string, unknown> | undefined;
        if (!result) break;

        // Code stats — keep max across deliveries
        const cf = (result.changedFiles as string[] | undefined)?.length ?? 0;
        if (cf > this.filesChanged) this.filesChanged = cf;

        if (result.diffStat) {
          this.diffStat = result.diffStat as string;
          const addMatch = this.diffStat.match(/(\d+)\s*insertion/);
          const delMatch = this.diffStat.match(/(\d+)\s*deletion/);
          if (addMatch) this.linesAdded = Math.max(this.linesAdded, parseInt(addMatch[1], 10));
          if (delMatch) this.linesRemoved = Math.max(this.linesRemoved, parseInt(delMatch[1], 10));
        }

        // Test result
        const tr = result.testResult as string | undefined;
        if (tr === "passed" || tr === "failed") this.testResult = tr;

        // Tokens
        const tu = result.tokenUsage as { inputTokens?: number; outputTokens?: number } | undefined;
        if (tu) {
          this.inputTokens += tu.inputTokens ?? 0;
          this.outputTokens += tu.outputTokens ?? 0;
        }

        // Review detection
        const role = this.agents.get(agentId)?.role ?? "";
        const summary = (result.summary as string) ?? "";

        if (role === "reviewer" || /verdict/i.test(summary)) {
          this.reviewCount++;
          const verdict = /pass/i.test(summary) ? "pass" as const : /fail/i.test(summary) ? "fail" as const : "unknown" as const;
          this.reviewRounds.push({ round: this.reviewCount, verdict, snippet: summary.slice(0, 120) });
          this.milestones.push({
            type: verdict === "pass" ? "pass" : "review",
            agentName: name, timestamp: now,
            label: verdict === "pass" ? `Review PASS (Round ${this.reviewCount})` : `Review Round ${this.reviewCount}`,
          });
        } else {
          this.milestones.push({
            type: ev.isFinalResult ? "done" : "coding",
            agentName: name, timestamp: now,
            label: ev.isFinalResult ? "Project complete" : "Code delivered",
          });
        }
        break;
      }

      case "TASK_DELEGATED": {
        const toName = this.getName(ev.toAgentId as string);
        const toRole = [...this.agents.values()].find(a => a.name === toName)?.role ?? "";
        if (toRole === "reviewer") {
          this.milestones.push({ type: "review", agentName: toName, timestamp: now, label: `Review delegated to ${toName}` });
        }
        break;
      }

      case "TOKEN_UPDATE": {
        // Incremental token tracking (more accurate than TASK_DONE aggregation)
        this.inputTokens += (ev.inputTokens as number) ?? 0;
        this.outputTokens += (ev.outputTokens as number) ?? 0;
        break;
      }

      // All other event types: ignored (zero cost)
    }
  }

  /** Set archive-level token usage (overrides per-event accumulation). */
  setTokenUsage(input: number, output: number) {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  /** Produce the final RecapData snapshot. Cheap — just copies accumulated state. */
  toRecapData(): RecapData {
    const endedAt = this.endedAt || Date.now();
    const startedAt = this.startedAt || endedAt;
    const lastReview = this.reviewRounds[this.reviewRounds.length - 1];

    return {
      projectName: this.projectName,
      agents: [...this.agents.values()],
      startedAt,
      endedAt,
      durationSec: Math.round((endedAt - startedAt) / 1000),
      filesChanged: this.filesChanged,
      linesAdded: this.linesAdded,
      linesRemoved: this.linesRemoved,
      diffStat: this.diffStat,
      totalInputTokens: this.inputTokens,
      totalOutputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      reviewRounds: [...this.reviewRounds],
      finalVerdict: lastReview?.verdict ?? "unknown",
      testResult: this.testResult,
      milestones: [...this.milestones],
    };
  }

  /** Reset for a new project. */
  reset(projectName: string) {
    this.projectName = projectName;
    this.agents.clear();
    this.agentNames.clear();
    this.startedAt = 0;
    this.endedAt = 0;
    this.filesChanged = 0;
    this.linesAdded = 0;
    this.linesRemoved = 0;
    this.diffStat = "";
    this.testResult = "unknown";
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.reviewRounds = [];
    this.reviewCount = 0;
    this.milestones = [];
  }

  private getName(agentId: string): string {
    return this.agentNames.get(agentId) ?? agentId;
  }
}

// =====================================================================
// PATH 2: Archive extraction — for historical projects
// =====================================================================

interface AnyEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Extract recap data from a stored ProjectArchive.
 * Fallback for projects that weren't tracked by a live RecapCollector.
 */
export function extractRecapData(archive: {
  name?: string;
  startedAt?: number;
  endedAt?: number;
  agents?: Array<{ agentId?: string; name: string; role: string; palette?: number }>;
  events?: AnyEvent[];
  tokenUsage?: { inputTokens: number; outputTokens: number };
}): RecapData {
  // Reuse the collector internally — same logic, single code path
  const collector = new RecapCollector(archive.name ?? "Untitled Project");

  // Register agents
  for (const a of archive.agents ?? []) {
    const id = a.agentId ?? a.name;
    collector.addAgent(id, a.name, a.role, a.palette);
  }

  // Set archive-level token usage if available
  if (archive.tokenUsage) {
    collector.setTokenUsage(archive.tokenUsage.inputTokens, archive.tokenUsage.outputTokens);
  }

  // Replay events through collector
  for (const ev of archive.events ?? []) {
    collector.onEvent(ev);
  }

  // Override timestamps with archive values (more accurate)
  const data = collector.toRecapData();
  if (archive.startedAt) data.startedAt = archive.startedAt;
  if (archive.endedAt) data.endedAt = archive.endedAt;
  data.durationSec = Math.round((data.endedAt - data.startedAt) / 1000);

  return data;
}

// ---- Helpers ----

function normalizeRole(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("review")) return "reviewer";
  if (r.includes("lead")) return "leader";
  if (r.includes("dev")) return "dev";
  return r;
}
