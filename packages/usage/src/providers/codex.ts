import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type {
  UsageProvider,
  ScanOptions,
  ProviderUsage,
  ModelUsage,
  DailyUsage,
  QuotaInfo,
  LocalUsage,
} from "../types.js";
import { getCodexPricing, calculateCost } from "../pricing.js";

const SESSIONS_DIR = ".codex/sessions";

interface CodexAuth {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

interface WhamWindowSnapshot {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}

interface WhamCredits {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: number;
}

interface WhamUsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: WhamWindowSnapshot;
    secondary_window?: WhamWindowSnapshot;
  };
  credits?: WhamCredits;
}

export class CodexProvider implements UsageProvider {
  readonly id = "codex";
  readonly displayName = "OpenAI Codex";

  async detect(opts: ScanOptions): Promise<boolean> {
    const home = opts.homeDir ?? process.env.HOME ?? "";
    return fs.existsSync(path.join(home, SESSIONS_DIR));
  }

  async scan(opts: ScanOptions): Promise<ProviderUsage> {
    const base: ProviderUsage = {
      provider: this.id,
      displayName: this.displayName,
      available: true,
      models: [],
      daily: [],
    };

    const [logsResult, quotaResult] = await Promise.allSettled([
      this.scanLogs(opts),
      this.fetchQuota(opts),
    ]);

    if (logsResult.status === "fulfilled") {
      base.localUsage = logsResult.value.localUsage;
      base.models = logsResult.value.models;
      base.daily = logsResult.value.daily;
      base.lastActivity = logsResult.value.lastActivity;
    }

    if (quotaResult.status === "fulfilled" && quotaResult.value.length > 0) {
      base.quotas = quotaResult.value;
      base.quota = quotaResult.value[0];
    }

    return base;
  }

  private async fetchQuota(opts: ScanOptions): Promise<QuotaInfo[]> {
    const home = opts.homeDir ?? process.env.HOME ?? "";
    const authPath = path.join(home, ".codex", "auth.json");

    if (!fs.existsSync(authPath)) return [];

    let auth: CodexAuth;
    try {
      auth = JSON.parse(fs.readFileSync(authPath, "utf-8"));
    } catch {
      return [];
    }

    if (!auth.access_token) return [];

    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        Accept: "application/json",
        "User-Agent": "CodexBar",
      },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as WhamUsageResponse;
    const quotas: QuotaInfo[] = [];

    if (data.rate_limit?.primary_window) {
      quotas.push(windowToQuota("Session", data.rate_limit.primary_window));
    }
    if (data.rate_limit?.secondary_window) {
      const q = windowToQuota("Weekly", data.rate_limit.secondary_window);
      if (q.resetsAt) {
        const windowDays = (data.rate_limit.secondary_window.limit_window_seconds ?? 604800) / 86400;
        q.pacePercent = calculatePace(q.usedPercent, q.resetsAt, windowDays);
        q.paceDescription =
          q.pacePercent < 0
            ? `${Math.abs(q.pacePercent).toFixed(0)}% under budget`
            : `${q.pacePercent.toFixed(0)}% over budget`;
      }
      quotas.push(q);
    }
    if (data.credits?.has_credits && data.credits.balance != null) {
      quotas.push({
        label: "Credits",
        usedPercent: 0,
        resetDescription: data.credits.unlimited
          ? "Unlimited"
          : `$${data.credits.balance.toFixed(2)} remaining`,
      });
    }

    return quotas;
  }

  private async scanLogs(
    opts: ScanOptions,
  ): Promise<{
    localUsage: LocalUsage;
    models: ModelUsage[];
    daily: DailyUsage[];
    lastActivity?: string;
  }> {
    const home = opts.homeDir ?? process.env.HOME ?? "";
    const sessionsRoot = path.join(home, SESSIONS_DIR);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opts.days);

    const modelMap = new Map<
      string,
      { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number }
    >();
    const dailyMap = new Map<
      string,
      { input: number; output: number; cost: number; sessions: Set<string> }
    >();

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    const sessionFiles = new Set<string>();
    let lastActivity: string | undefined;

    const jsonlFiles = findSessionFiles(sessionsRoot, cutoff);

    for (const file of jsonlFiles) {
      sessionFiles.add(file);
      let currentModel = "unknown";

      try {
        await processJsonlFile(file, (line) => {
          try {
            const entry = JSON.parse(line);

            if (entry.type === "turn_context" && entry.model) {
              currentModel = entry.model;
              return;
            }

            const tokenCount =
              entry.token_count ??
              entry.event_msg?.token_count ??
              entry.usage?.total_tokens;
            if (tokenCount == null) return;

            const role = entry.role ?? entry.event_msg?.role ?? "assistant";
            const isInput = role === "user" || role === "system";
            const inputTokens = isInput ? tokenCount : 0;
            const outputTokens = isInput ? 0 : tokenCount;
            const cacheRead: number =
              entry.usage?.cache_read_input_tokens ??
              entry.event_msg?.cache_read_input_tokens ?? 0;
            const cacheWrite: number =
              entry.usage?.cache_creation_input_tokens ??
              entry.event_msg?.cache_creation_input_tokens ?? 0;

            const pricing = getCodexPricing(currentModel);
            const cost = calculateCost(pricing, inputTokens, outputTokens, cacheRead, cacheWrite);

            totalInput += inputTokens;
            totalOutput += outputTokens;
            totalCacheRead += cacheRead;
            totalCacheWrite += cacheWrite;
            totalCost += cost;

            const existing = modelMap.get(currentModel) ?? {
              input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0,
            };
            existing.input += inputTokens;
            existing.output += outputTokens;
            existing.cacheRead += cacheRead;
            existing.cacheWrite += cacheWrite;
            existing.requests += 1;
            modelMap.set(currentModel, existing);

            const dateStr = extractDateFromPath(file);
            if (dateStr) {
              const day = dailyMap.get(dateStr) ?? {
                input: 0, output: 0, cost: 0, sessions: new Set<string>(),
              };
              day.input += inputTokens;
              day.output += outputTokens;
              day.cost += cost;
              day.sessions.add(file);
              dailyMap.set(dateStr, day);

              const ts = `${dateStr}T00:00:00Z`;
              if (!lastActivity || ts > lastActivity) lastActivity = ts;
            }
          } catch {
            // skip malformed lines
          }
        });
      } catch {
        // skip unreadable files
      }
    }

    const now = new Date();
    const localUsage: LocalUsage = {
      periodLabel: `Last ${opts.days} days`,
      startDate: cutoff.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      costUsd: totalCost,
      sessionCount: sessionFiles.size,
    };

    const models: ModelUsage[] = Array.from(modelMap.entries()).map(
      ([model, data]) => ({
        model,
        inputTokens: data.input,
        outputTokens: data.output,
        cacheReadTokens: data.cacheRead,
        cacheWriteTokens: data.cacheWrite,
        costUsd: calculateCost(
          getCodexPricing(model),
          data.input,
          data.output,
          data.cacheRead,
          data.cacheWrite,
        ),
        requestCount: data.requests,
      }),
    );

    const daily: DailyUsage[] = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        inputTokens: data.input,
        outputTokens: data.output,
        costUsd: data.cost,
        sessionCount: data.sessions.size,
      }));

    return { localUsage, models, daily, lastActivity };
  }
}

/**
 * Walk YYYY/MM/DD directory structure under sessionsRoot,
 * returning .jsonl files whose date is on or after cutoff.
 */
function findSessionFiles(sessionsRoot: string, cutoff: Date): string[] {
  const files: string[] = [];
  if (!fs.existsSync(sessionsRoot)) return files;

  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let years: string[];
  try {
    years = fs.readdirSync(sessionsRoot).filter((d) => /^\d{4}$/.test(d));
  } catch {
    return files;
  }

  for (const year of years) {
    const yearPath = path.join(sessionsRoot, year);
    let months: string[];
    try {
      months = fs.readdirSync(yearPath).filter((d) => /^\d{2}$/.test(d));
    } catch {
      continue;
    }

    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      let days: string[];
      try {
        days = fs.readdirSync(monthPath).filter((d) => /^\d{2}$/.test(d));
      } catch {
        continue;
      }

      for (const day of days) {
        const dateStr = `${year}-${month}-${day}`;
        if (dateStr < cutoffStr) continue;

        const dayPath = path.join(monthPath, day);
        let entries: string[];
        try {
          entries = fs.readdirSync(dayPath);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (entry.endsWith(".jsonl")) {
            files.push(path.join(dayPath, entry));
          }
        }
      }
    }
  }

  return files;
}

function extractDateFromPath(filePath: string): string | undefined {
  const match = filePath.match(/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return undefined;
}

function processJsonlFile(
  filePath: string,
  handler: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", handler);
    rl.on("close", resolve);
    rl.on("error", reject);
    stream.on("error", reject);
  });
}

function windowToQuota(label: string, w: WhamWindowSnapshot): QuotaInfo {
  const resetEpoch = w.reset_at ? w.reset_at * 1000 : undefined;
  let resetsAt: string | undefined;
  let resetDescription: string | undefined;

  if (resetEpoch) {
    resetsAt = new Date(resetEpoch).toISOString();
    const diffMs = resetEpoch - Date.now();
    if (diffMs > 0) {
      const hours = Math.floor(diffMs / 3_600_000);
      const mins = Math.floor((diffMs % 3_600_000) / 60_000);
      resetDescription = hours > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${mins}m`;
    }
  }

  return {
    label,
    usedPercent: w.used_percent ?? 0,
    resetsAt,
    resetDescription,
  };
}

function calculatePace(
  usedPercent: number,
  resetsAt: string,
  windowDays: number,
): number {
  const now = Date.now();
  const reset = new Date(resetsAt).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const elapsed = windowMs - (reset - now);
  if (elapsed <= 0) return 0;
  const expectedPercent = (elapsed / windowMs) * 100;
  return usedPercent - expectedPercent;
}
