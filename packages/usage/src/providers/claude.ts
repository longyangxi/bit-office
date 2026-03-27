import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { execFile } from "node:child_process";
import type {
  UsageProvider,
  ScanOptions,
  ProviderUsage,
  ModelUsage,
  DailyUsage,
  QuotaInfo,
  LocalUsage,
  AccountInfo,
} from "../types.js";
import { getClaudePricing, calculateCost } from "../pricing.js";

const CLAUDE_DIRS = [".claude/projects", ".config/claude/projects"];
const KEYCHAIN_SERVICE = "Claude Code-credentials";

interface OAuthUsageWindow {
  utilization?: number;
  resets_at?: string;
}

interface OAuthExtraUsage {
  is_enabled?: boolean;
  monthly_limit?: number;
  used_credits?: number;
  utilization?: number;
  currency?: string;
}

interface OAuthUsageResponse {
  five_hour?: OAuthUsageWindow;
  seven_day?: OAuthUsageWindow;
  seven_day_oauth_apps?: OAuthUsageWindow;
  seven_day_opus?: OAuthUsageWindow;
  seven_day_sonnet?: OAuthUsageWindow;
  iguana_necktie?: OAuthUsageWindow;
  extra_usage?: OAuthExtraUsage;
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

    if (quotaResult.status === "fulfilled" && quotaResult.value.quotas.length > 0) {
      base.quotas = quotaResult.value.quotas;
      base.quota = quotaResult.value.quotas[0];
      if (quotaResult.value.account) base.account = quotaResult.value.account;
    }

    return base;
  }

  private async readAccessToken(opts: ScanOptions): Promise<{ accessToken: string; plan?: string; tier?: string } | null> {
    const home = opts.homeDir ?? process.env.HOME ?? "";

    // 1. Try credentials file first
    const credPath = path.join(home, ".claude", ".credentials.json");
    if (fs.existsSync(credPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credPath, "utf-8"));
        const oauth = raw?.claudeAiOauth;
        if (oauth?.accessToken) {
          return {
            accessToken: oauth.accessToken,
            plan: oauth.subscriptionType,
            tier: oauth.rateLimitTier,
          };
        }
      } catch { /* fall through */ }
    }

    // 2. Try macOS Keychain via /usr/bin/security
    if (process.platform === "darwin") {
      try {
        const keychainJson = await runSecurityCLI(KEYCHAIN_SERVICE);
        if (keychainJson) {
          const raw = JSON.parse(keychainJson);
          const oauth = raw?.claudeAiOauth;
          if (oauth?.accessToken) {
            return {
              accessToken: oauth.accessToken,
              plan: oauth.subscriptionType,
              tier: oauth.rateLimitTier,
            };
          }
        }
      } catch { /* fall through */ }
    }

    return null;
  }

  private async fetchQuota(opts: ScanOptions): Promise<{ quotas: QuotaInfo[]; account?: AccountInfo }> {
    const creds = await this.readAccessToken(opts);
    if (!creds) return { quotas: [] };

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
    });

    if (!res.ok) return { quotas: [] };

    const data = (await res.json()) as OAuthUsageResponse;
    const quotas: QuotaInfo[] = [];

    if (data.five_hour) {
      quotas.push(windowToQuota("Session (5h)", data.five_hour));
    }
    if (data.seven_day) {
      const q = windowToQuota("Weekly", data.seven_day);
      if (q.resetsAt) {
        q.pacePercent = calculatePace(q.usedPercent, q.resetsAt, 7);
        q.paceDescription =
          q.pacePercent < 0
            ? `${Math.abs(q.pacePercent).toFixed(0)}% under budget`
            : `${q.pacePercent.toFixed(0)}% over budget`;
      }
      quotas.push(q);
    }
    if (data.seven_day_sonnet) {
      quotas.push(windowToQuota("Sonnet (7d)", data.seven_day_sonnet));
    }
    if (data.seven_day_opus) {
      quotas.push(windowToQuota("Opus (7d)", data.seven_day_opus));
    }
    if (data.extra_usage?.is_enabled) {
      const eu = data.extra_usage;
      quotas.push({
        label: "Extra usage",
        usedPercent: (eu.utilization ?? 0) * 100,
        spentUsd: eu.used_credits ?? 0,
        limitUsd: eu.monthly_limit ?? 0,
      });
    }

    const account: AccountInfo | undefined = creds.plan
      ? { plan: creds.plan, tier: creds.tier }
      : undefined;

    return { quotas, account };
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

function windowToQuota(label: string, w: OAuthUsageWindow): QuotaInfo {
  const resetDate = w.resets_at ? new Date(w.resets_at) : undefined;
  let resetDescription: string | undefined;
  if (resetDate && !isNaN(resetDate.getTime())) {
    const diffMs = resetDate.getTime() - Date.now();
    if (diffMs > 0) {
      const hours = Math.floor(diffMs / 3_600_000);
      const mins = Math.floor((diffMs % 3_600_000) / 60_000);
      resetDescription = hours > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${mins}m`;
    }
  }

  return {
    label,
    usedPercent: (w.utilization ?? 0) * 100,
    resetsAt: w.resets_at,
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

function runSecurityCLI(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout?.trim()) {
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}
