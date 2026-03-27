import type {
  UsageProvider,
  ScanOptions,
  ProviderUsage,
  UsageReport,
} from "./types.js";

import { ClaudeProvider } from "./providers/claude.js";
import { CodexProvider } from "./providers/codex.js";
import { GeminiProvider } from "./providers/gemini.js";
import { CursorProvider } from "./providers/cursor.js";
import { CopilotProvider } from "./providers/copilot.js";
import { KiroProvider } from "./providers/kiro.js";
import { JetBrainsProvider } from "./providers/jetbrains.js";
import { AmpProvider } from "./providers/amp.js";
import { OpenRouterProvider } from "./providers/openrouter.js";

const BUILTIN_PROVIDERS: UsageProvider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
  new GeminiProvider(),
  new CursorProvider(),
  new CopilotProvider(),
  new KiroProvider(),
  new JetBrainsProvider(),
  new AmpProvider(),
  new OpenRouterProvider(),
];

export interface ScannerOptions {
  /** How many days of history to scan (default: 30). */
  days?: number;
  /** Override home directory (for testing). */
  homeDir?: string;
  /** Only scan these provider IDs (default: all). */
  providers?: string[];
  /** Extra providers to include beyond builtins. */
  extraProviders?: UsageProvider[];
}

export async function scanUsage(options: ScannerOptions = {}): Promise<UsageReport> {
  const opts: ScanOptions = {
    days: options.days ?? 30,
    homeDir: options.homeDir,
  };

  let allProviders = [...BUILTIN_PROVIDERS];
  if (options.extraProviders) {
    allProviders = allProviders.concat(options.extraProviders);
  }

  if (options.providers && options.providers.length > 0) {
    const allowed = new Set(options.providers);
    allProviders = allProviders.filter((p) => allowed.has(p.id));
  }

  const results = await Promise.allSettled(
    allProviders.map(async (provider): Promise<ProviderUsage | null> => {
      const detected = await provider.detect(opts);
      if (!detected) {
        return {
          provider: provider.id,
          displayName: provider.displayName,
          available: false,
          models: [],
          daily: [],
        };
      }
      return provider.scan(opts);
    }),
  );

  const providers: ProviderUsage[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      providers.push(result.value);
    }
  }

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    sessionCount: 0,
  };

  for (const p of providers) {
    if (p.localUsage) {
      totals.inputTokens += p.localUsage.inputTokens;
      totals.outputTokens += p.localUsage.outputTokens;
      totals.cacheReadTokens += p.localUsage.cacheReadTokens;
      totals.cacheWriteTokens += p.localUsage.cacheWriteTokens;
      totals.costUsd += p.localUsage.costUsd;
      totals.sessionCount += p.localUsage.sessionCount;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    periodDays: opts.days,
    providers,
    totals,
  };
}

export function listProviders(
  extraProviders?: UsageProvider[],
): Array<{ id: string; displayName: string }> {
  let all = [...BUILTIN_PROVIDERS];
  if (extraProviders) all = all.concat(extraProviders);
  return all.map((p) => ({ id: p.id, displayName: p.displayName }));
}
