/**
 * recap-data.ts — Extract project milestones from a ProjectArchive event stream.
 *
 * This module is the ONLY coupling point with the existing system.
 * It consumes the same GatewayEvent[] stored in project-history JSON
 * and produces a flat RecapData object that the renderer consumes.
 */

// ---- Lightweight types mirroring gateway's ProjectArchive ----
// We intentionally re-declare a minimal subset so this module has
// zero import-time dependency on gateway code.

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
  diffStat: string;       // raw diffStat string from TASK_DONE

  // AI stats
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;

  // Reviews
  reviewRounds: RecapReviewRound[];
  finalVerdict: "pass" | "fail" | "unknown";

  // Test
  testResult: "passed" | "failed" | "unknown";

  // Key moments (timestamps for animation pacing)
  milestones: MilestoneEntry[];
}

export interface MilestoneEntry {
  type: "start" | "coding" | "review" | "fix" | "pass" | "done";
  agentName: string;
  timestamp: number;
  label: string;
}

// ---- Extraction ----

interface AnyEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Extract recap data from a raw ProjectArchive-shaped object.
 * Accepts `any` so callers don't need to import gateway types.
 */
export function extractRecapData(archive: {
  name?: string;
  startedAt?: number;
  endedAt?: number;
  agents?: Array<{ name: string; role: string; palette?: number }>;
  events?: AnyEvent[];
  tokenUsage?: { inputTokens: number; outputTokens: number };
}): RecapData {
  const events = (archive.events ?? []) as AnyEvent[];
  const agents: RecapAgent[] = (archive.agents ?? []).map(a => ({
    name: a.name,
    role: normalizeRole(a.role),
    palette: a.palette,
  }));

  const startedAt = archive.startedAt ?? Date.now();
  const endedAt = archive.endedAt ?? Date.now();

  // --- Accumulate from events ---
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let diffStat = "";
  let testResult: "passed" | "failed" | "unknown" = "unknown";
  let totalInput = archive.tokenUsage?.inputTokens ?? 0;
  let totalOutput = archive.tokenUsage?.outputTokens ?? 0;
  const reviewRounds: RecapReviewRound[] = [];
  const milestones: MilestoneEntry[] = [];
  let reviewCount = 0;

  // Agent name lookup from AGENT_CREATED events
  const agentNames = new Map<string, string>();
  for (const a of archive.agents ?? []) {
    // PersistedAgent has agentId
    const id = (a as unknown as { agentId?: string }).agentId;
    if (id) agentNames.set(id, a.name);
  }
  const getName = (id: string) => agentNames.get(id) ?? id;

  for (const ev of events) {
    switch (ev.type) {
      case "TASK_STARTED": {
        const agentId = ev.agentId as string;
        milestones.push({
          type: "start",
          agentName: getName(agentId),
          timestamp: (ev as { timestamp?: number }).timestamp ?? startedAt,
          label: "Task started",
        });
        break;
      }

      case "TASK_DONE": {
        const agentId = ev.agentId as string;
        const result = ev.result as {
          changedFiles?: string[];
          diffStat?: string;
          testResult?: string;
          summary?: string;
          tokenUsage?: { inputTokens: number; outputTokens: number };
        } | undefined;

        if (result) {
          const cf = result.changedFiles?.length ?? 0;
          if (cf > filesChanged) filesChanged = cf;

          if (result.diffStat) {
            diffStat = result.diffStat;
            const addMatch = diffStat.match(/(\d+)\s*insertion/);
            const delMatch = diffStat.match(/(\d+)\s*deletion/);
            if (addMatch) linesAdded = Math.max(linesAdded, parseInt(addMatch[1], 10));
            if (delMatch) linesRemoved = Math.max(linesRemoved, parseInt(delMatch[1], 10));
          }

          if (result.testResult === "passed" || result.testResult === "failed") {
            testResult = result.testResult;
          }

          // Token usage from individual task results (if archive-level is missing)
          if (!archive.tokenUsage && result.tokenUsage) {
            totalInput += result.tokenUsage.inputTokens;
            totalOutput += result.tokenUsage.outputTokens;
          }

          // Detect review verdicts (reviewer agents)
          const name = getName(agentId);
          const role = agents.find(a => a.name === name)?.role ?? "";
          const summary = result.summary ?? "";

          if (role === "reviewer" || /verdict/i.test(summary)) {
            reviewCount++;
            const verdict = /pass/i.test(summary) ? "pass" : /fail/i.test(summary) ? "fail" : "unknown";
            reviewRounds.push({
              round: reviewCount,
              verdict,
              snippet: summary.slice(0, 120),
            });
            milestones.push({
              type: verdict === "pass" ? "pass" : "review",
              agentName: name,
              timestamp: (ev as { timestamp?: number }).timestamp ?? endedAt,
              label: verdict === "pass" ? `Review PASS (Round ${reviewCount})` : `Review Round ${reviewCount}`,
            });
          } else {
            milestones.push({
              type: ev.isFinalResult ? "done" : "coding",
              agentName: name,
              timestamp: (ev as { timestamp?: number }).timestamp ?? endedAt,
              label: ev.isFinalResult ? "Project complete" : "Code delivered",
            });
          }
        }
        break;
      }

      case "TASK_DELEGATED": {
        const to = getName(ev.toAgentId as string);
        const toRole = agents.find(a => a.name === to)?.role ?? "";
        if (toRole === "reviewer") {
          milestones.push({
            type: "review",
            agentName: to,
            timestamp: (ev as { timestamp?: number }).timestamp ?? endedAt,
            label: `Review delegated to ${to}`,
          });
        }
        break;
      }
    }
  }

  // Determine final verdict
  const lastReview = reviewRounds[reviewRounds.length - 1];
  const finalVerdict = lastReview?.verdict ?? "unknown";

  return {
    projectName: archive.name ?? "Untitled Project",
    agents,
    startedAt,
    endedAt,
    durationSec: Math.round((endedAt - startedAt) / 1000),
    filesChanged,
    linesAdded,
    linesRemoved,
    diffStat,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    reviewRounds,
    finalVerdict,
    testResult,
    milestones,
  };
}

// ---- Helpers ----

function normalizeRole(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("review")) return "reviewer";
  if (r.includes("lead")) return "leader";
  if (r.includes("dev")) return "dev";
  return r;
}
