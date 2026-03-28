"use client";
import { useMemo } from "react";
import { useOfficeStore } from "@/store/office-store";
import type { ProjectSummary } from "@/store/office-store";

export interface AgentStat {
  agentId: string;
  name: string;
  role: string;
  tasksCompleted: number;
  totalTokens: number;
  avgTaskDurationMs: number;
  status: string;
  costUsd: number;
}

export interface HeatmapCell {
  date: string;       // YYYY-MM-DD
  count: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface DashboardData {
  totalProjects: number;
  totalFilesChanged: number;
  totalTokens: { input: number; output: number };
  totalCostUsd: number;
  agentStats: AgentStat[];
  heatmapData: HeatmapCell[];
}

function toIntensity(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

export function useDashboardData(): DashboardData {
  const projectList = useOfficeStore((s) => s.projectList);
  const agents = useOfficeStore((s) => s.agents);

  return useMemo(() => {
    // ── Summary stats ──
    const totalProjects = projectList.length;

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let totalFiles = 0;

    for (const p of projectList) {
      if (p.tokenUsage) {
        totalInput += p.tokenUsage.inputTokens;
        totalOutput += p.tokenUsage.outputTokens;
        totalCost += p.tokenUsage.costUsd ?? 0;
      }
    }

    // Add current agent tokens (not yet in projectList)
    for (const [, a] of agents) {
      totalInput += a.tokenUsage.inputTokens;
      totalOutput += a.tokenUsage.outputTokens;
      totalCost += a.tokenUsage.costUsd ?? 0;
    }

    // Estimate files from event count (rough proxy)
    for (const p of projectList) {
      totalFiles += p.eventCount;
    }

    // ── Per-agent stats ──
    const agentStats: AgentStat[] = [];
    for (const [, a] of agents) {
      const tasks = a.messages.filter(
        (m) => m.role === "agent" && m.isFinalResult
      ).length;
      const durations = a.messages
        .filter((m) => m.role === "agent" && m.isFinalResult && m.durationMs)
        .map((m) => m.durationMs!);
      const avgDuration =
        durations.length > 0
          ? durations.reduce((s, d) => s + d, 0) / durations.length
          : 0;

      agentStats.push({
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        tasksCompleted: tasks,
        totalTokens: a.tokenUsage.inputTokens + a.tokenUsage.outputTokens,
        avgTaskDurationMs: avgDuration,
        status: a.status,
        costUsd: a.tokenUsage.costUsd ?? 0,
      });
    }
    agentStats.sort((a, b) => b.tasksCompleted - a.tasksCompleted);

    // ── Heatmap (last 12 weeks) ──
    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const start = new Date(now.getTime() - 12 * weekMs);
    start.setHours(0, 0, 0, 0);

    // Count tasks per day from projectList endedAt
    const dayCounts = new Map<string, number>();
    for (const p of projectList) {
      if (p.endedAt < start.getTime()) continue;
      const key = toDateStr(p.endedAt);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }

    // Build 12 weeks × 7 days grid
    const heatmapData: HeatmapCell[] = [];
    const cursor = new Date(start);
    // Align to Monday
    const dayOfWeek = cursor.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    cursor.setDate(cursor.getDate() + mondayOffset);

    const endTs = now.getTime();
    while (cursor.getTime() <= endTs) {
      const dateStr = toDateStr(cursor.getTime());
      const count = dayCounts.get(dateStr) ?? 0;
      heatmapData.push({ date: dateStr, count, intensity: toIntensity(count) });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      totalProjects,
      totalFilesChanged: totalFiles,
      totalTokens: { input: totalInput, output: totalOutput },
      totalCostUsd: totalCost,
      agentStats,
      heatmapData,
    };
  }, [projectList, agents]);
}
