/**
 * Usage module types.
 *
 * Provider interface + unified usage data structures.
 */

// ── Provider interface ──────────────────────────────────────────────

export interface ScanOptions {
  /** How many days of history to scan (default: 30). */
  days: number;
  /** Override home directory (for testing). */
  homeDir?: string;
}

export interface UsageProvider {
  /** Stable identifier (e.g. "claude", "codex", "gemini"). */
  readonly id: string;
  /** Human-readable name. */
  readonly displayName: string;
  /** Check if this provider's CLI/data is available on the machine. */
  detect(opts: ScanOptions): Promise<boolean>;
  /** Scan local logs/state for usage data. */
  scan(opts: ScanOptions): Promise<ProviderUsage>;
}

// ── Usage data ──────────────────────────────────────────────────────

export interface ProviderUsage {
  provider: string;
  displayName: string;
  available: boolean;
  /** Local log usage (scanned from JSONL / SQLite / XML). */
  localUsage?: LocalUsage;
  /** Quota/limit info (if detectable from local state). */
  quota?: QuotaInfo;
  /** Multiple quota windows (session, weekly, model-specific, credits). */
  quotas?: QuotaInfo[];
  /** Account/plan info. */
  account?: AccountInfo;
  /** Model breakdown within this provider. */
  models: ModelUsage[];
  /** Per-day breakdown (for charts). */
  daily: DailyUsage[];
  lastActivity?: string;
}

export interface LocalUsage {
  periodLabel: string;
  startDate: string;
  endDate: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  sessionCount: number;
}

export interface QuotaInfo {
  /** e.g. "Session" or "Weekly" or "Sonnet" or "Extra usage". */
  label: string;
  usedPercent: number;
  resetsAt?: string;
  resetDescription?: string;
  /** Pace info: negative = behind budget, positive = ahead. */
  pacePercent?: number;
  paceDescription?: string;
  /** For cost-based quotas (e.g. extra usage). */
  spentUsd?: number;
  limitUsd?: number;
}

export interface AccountInfo {
  email?: string;
  plan?: string;
  tier?: string;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  requestCount: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  sessionCount: number;
}

// ── Aggregated report ───────────────────────────────────────────────

export interface UsageReport {
  generatedAt: string;
  periodDays: number;
  providers: ProviderUsage[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    sessionCount: number;
  };
}

// ── Pricing (public) ────────────────────────────────────────────────

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
