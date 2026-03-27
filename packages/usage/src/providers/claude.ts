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
import { getClaudePricing, calculateCost } from "../pricing.js";

const CLAUDE_DIRS = [".claude/projects", ".config/claude/projects"];

interface ClaudeCredentials {
  accessToken?: string;
  expiresAt?: string;
}

interface OAuthQuotaResponse {
  quotas?: Array<{
    quota_type?: string;
    used_percent?: number;
    resets_at?: string;
    reset_description?: string;
    spent_usd?: number;
    limit_usd?: number;
  }>;
}

export class ClaudeProvider implements UsageProvider {
  readonly id = "claude";
  readonly displayName = "Claude Code";

  async detect(opts: ScanOptions): Promise<boolean> {
    const home = opts.homeDir ?? process.env.HOME ?? "";
    return CLAUDE_DIRS.some((dir) =>
      fs.existsSync(path.join(home, dir)),
    );
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
    const credPath = path.join(home, ".claude", ".credentials.json");

    if (!fs.existsSync(credPath)) return [];

    let creds: ClaudeCredentials;
    try {
      creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    } catch {
      return [];
    }

    if (!creds.accessToken) return [];

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-usage-2025-06-01",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as OAuthQuotaResponse;
    if (!data.quotas || !Array.isArray(data.quotas)) return [];

    const quotas: QuotaInfo[] = data.quotas.map((q) => {
      const info: QuotaInfo = {
        label: formatQuotaLabel(q.quota_type),
        usedPercent: q.used_percent ?? 0,
        resetsAt: q.resets_at,
        resetDescription: q.reset_description,
      };

      if (q.spent_usd != null) info.spentUsd = q.spent_usd;
      if (q.limit_usd != null) info.limitUsd = q.limit_usd;

      return info;
    });

    const weekly = quotas.find(
      (q) => q.label === "Weekly" || q.label.includes("7-day"),
    );
    if (weekly?.resetsAt) {
      weekly.pacePercent = calculatePace(weekly.usedPercent, weekly.resetsAt, 7);
      weekly.paceDescription =
        weekly.pacePercent < 0
          ? `${Math.abs(weekly.pacePercent).toFixed(0)}% under budget`
          : `${weekly.pacePercent.toFixed(0)}% over budget`;
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opts.days);
    const cutoffMs = cutoff.getTime();

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
    let sessionFiles = new Set<string>();
    let lastActivity: string | undefined;

    const jsonlFiles = findJsonlFiles(home, CLAUDE_DIRS);

    for (const file of jsonlFiles) {
      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs < cutoffMs) continue;
      } catch {
        continue;
      }

      sessionFiles.add(file);

      try {
        await processJsonlFile(file, (line) => {
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.message?.usage) return;

            const usage = entry.message.usage;
            const model: string = entry.message?.model ?? entry.model ?? "unknown";
            const inputTokens: number = usage.input_tokens ?? 0;
            const outputTokens: number = usage.output_tokens ?? 0;
            const cacheRead: number = usage.cache_read_input_tokens ?? usage.cache_read ?? 0;
            const cacheWrite: number = usage.cache_creation_input_tokens ?? usage.cache_write ?? 0;

            const pricing = getClaudePricing(model);
            const cost = calculateCost(pricing, inputTokens, outputTokens, cacheRead, cacheWrite);

            totalInput += inputTokens;
            totalOutput += outputTokens;
            totalCacheRead += cacheRead;
            totalCacheWrite += cacheWrite;
            totalCost += cost;

            const existing = modelMap.get(model) ?? {
              input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0,
            };
            existing.input += inputTokens;
            existing.output += outputTokens;
            existing.cacheRead += cacheRead;
            existing.cacheWrite += cacheWrite;
            existing.requests += 1;
            modelMap.set(model, existing);

            const ts: string | undefined = entry.timestamp ?? entry.message?.timestamp;
            if (ts) {
              const date = ts.slice(0, 10);
              if (date >= cutoff.toISOString().slice(0, 10)) {
                const day = dailyMap.get(date) ?? {
                  input: 0, output: 0, cost: 0, sessions: new Set<string>(),
                };
                day.input += inputTokens;
                day.output += outputTokens;
                day.cost += cost;
                day.sessions.add(file);
                dailyMap.set(date, day);
              }
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
          getClaudePricing(model),
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

function findJsonlFiles(home: string, dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const full = path.join(home, dir);
    if (!fs.existsSync(full)) continue;
    walkDir(full, files);
  }
  return files;
}

function walkDir(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(p, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(p);
    }
  }
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

function formatQuotaLabel(type?: string): string {
  if (!type) return "Unknown";
  const map: Record<string, string> = {
    five_hour: "Session",
    seven_day: "Weekly",
    sonnet: "Sonnet",
    opus: "Opus",
    extra_usage: "Extra usage",
  };
  return map[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
