"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { sendCommand } from "@/lib/connection";
import { useOfficeStore } from "@/store/office-store";
import TermModal from "./primitives/TermModal";
import { TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM, TERM_BG, TERM_PANEL, TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_ACCENT, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SIZE, TERM_SIZE_SM, TERM_SIZE_XS, TERM_SIZE_2XS, TERM_SIZE_3XS, TERM_SIZE_2XL } from "./termTheme";

interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  requestCount: number;
}

interface LocalUsage {
  periodLabel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  sessionCount: number;
}

interface QuotaInfo {
  label: string;
  usedPercent: number;
  resetsAt?: string;
  resetDescription?: string;
  pacePercent?: number;
  paceDescription?: string;
  spentUsd?: number;
  limitUsd?: number;
}

interface AccountInfo {
  email?: string;
  plan?: string;
  tier?: string;
}

interface DailyUsage {
  date: string;
  costUsd: number;
  sessionCount: number;
}

interface ProviderUsage {
  provider: string;
  displayName: string;
  available: boolean;
  localUsage?: LocalUsage;
  quota?: QuotaInfo;
  quotas?: QuotaInfo[];
  account?: AccountInfo;
  models: ModelUsage[];
  daily: DailyUsage[];
  lastActivity?: string;
}

interface UsageReport {
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

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const S = {
  card: { background: TERM_SURFACE, border: `1px solid ${TERM_BORDER}`, borderRadius: 6, padding: "10px 12px", marginBottom: 8 } as const,
  mono: { fontFamily: "monospace" } as const,
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" } as const,
};

function QuotaBar({ quota }: { quota: QuotaInfo }) {
  const pct = Math.min(quota.usedPercent, 100);
  const color = pct > 90 ? TERM_SEM_RED : pct > 70 ? TERM_SEM_YELLOW : TERM_SEM_GREEN;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: TERM_SIZE_SM, marginBottom: 4 }}>{quota.label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ height: 6, flex: 1, background: TERM_BORDER, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.3s",
          }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: TERM_SIZE_2XS, marginTop: 3, opacity: 0.7 }}>
        <span>{pct.toFixed(0)}% used</span>
        {quota.resetDescription && <span>{quota.resetDescription}</span>}
      </div>
      {quota.paceDescription && (
        <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5, marginTop: 2 }}>{quota.paceDescription}</div>
      )}
    </div>
  );
}

function ProviderCard({ provider, expanded, onToggle }: { provider: ProviderUsage; expanded: boolean; onToggle: () => void }) {
  const hasData = provider.localUsage || provider.quotas?.length || provider.quota;
  const dotColor = provider.available ? (hasData ? TERM_SEM_GREEN : TERM_SEM_YELLOW) : TERM_DIM;
  const allQuotas = provider.quotas ?? (provider.quota ? [provider.quota] : []);

  return (
    <div style={S.card}>
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: TERM_SIZE }}>{provider.displayName}</span>
          {provider.account?.plan && (
            <span style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5, marginLeft: 6 }}>{provider.account.plan}</span>
          )}
        </div>
        {provider.localUsage && (
          <span style={{ ...S.mono, fontSize: TERM_SIZE_XS, opacity: 0.8 }}>
            {fmtTokens(provider.localUsage.inputTokens + provider.localUsage.outputTokens)}
          </span>
        )}
        <span style={{ fontSize: TERM_SIZE_2XS, opacity: 0.4, transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "none" }}>▶</span>
      </div>

      {allQuotas.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {allQuotas.map((q, i) => (
            <QuotaBar key={q.label + i} quota={q} />
          ))}
        </div>
      )}

      {expanded && provider.localUsage && (
        <div style={{ marginTop: 12, fontSize: TERM_SIZE_XS, lineHeight: "1.6" }}>
          <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5, marginBottom: 4 }}>Local usage ({provider.localUsage.periodLabel})</div>
          <div style={{ ...S.grid, opacity: 0.8 }}>
            <span>Sessions</span>
            <span style={{ textAlign: "right", ...S.mono }}>{provider.localUsage.sessionCount}</span>
            <span>Input</span>
            <span style={{ textAlign: "right", ...S.mono }}>{fmtTokens(provider.localUsage.inputTokens)}</span>
            <span>Output</span>
            <span style={{ textAlign: "right", ...S.mono }}>{fmtTokens(provider.localUsage.outputTokens)}</span>
            {provider.localUsage.cacheReadTokens > 0 && (
              <><span>Cache read</span><span style={{ textAlign: "right", ...S.mono }}>{fmtTokens(provider.localUsage.cacheReadTokens)}</span></>
            )}
            {provider.localUsage.cacheWriteTokens > 0 && (
              <><span>Cache write</span><span style={{ textAlign: "right", ...S.mono }}>{fmtTokens(provider.localUsage.cacheWriteTokens)}</span></>
            )}
          </div>

          {provider.models.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5, marginBottom: 4 }}>By model</div>
              {provider.models.map(m => (
                <div key={m.model} style={{ display: "flex", justifyContent: "space-between", fontSize: TERM_SIZE_2XS, opacity: 0.7, padding: "1px 0" }}>
                  <span style={S.mono}>{m.model}</span>
                  <span style={S.mono}>{fmtTokens(m.inputTokens + m.outputTokens)} ({m.requestCount})</span>
                </div>
              ))}
            </div>
          )}

          {provider.lastActivity && (
            <div style={{ fontSize: TERM_SIZE_3XS, opacity: 0.4, marginTop: 6 }}>
              Last activity: {fmtDate(provider.lastActivity)}
            </div>
          )}
        </div>
      )}

      {expanded && !hasData && provider.available && (
        <div style={{ marginTop: 8, fontSize: TERM_SIZE_2XS, opacity: 0.5 }}>
          Detected but no usage data available yet.
        </div>
      )}
    </div>
  );
}

function TokenChart({ providers }: { providers: ProviderUsage[] }) {
  const allDays = new Map<string, number>();
  for (const p of providers) {
    for (const d of p.daily) {
      allDays.set(d.date, (allDays.get(d.date) ?? 0) + d.sessionCount);
    }
  }
  if (allDays.size < 2) return null;

  const entries = [...allDays.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const max = Math.max(...entries.map(e => e[1]), 1);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5, marginBottom: 6 }}>Daily sessions (14d)</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
        {entries.map(([date, count]) => (
          <div
            key={date}
            title={`${date}: ${count} sessions`}
            style={{
              flex: 1,
              height: `${Math.max((count / max) * 100, 2)}%`,
              background: "linear-gradient(to top, #3b82f6, #60a5fa)",
              borderRadius: "2px 2px 0 0",
              minWidth: 4,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: TERM_SIZE_3XS, opacity: 0.3, marginTop: 2 }}>
        <span>{entries[0]?.[0]?.slice(5)}</span>
        <span>{entries[entries.length - 1]?.[0]?.slice(5)}</span>
      </div>
    </div>
  );
}

export default function UsagePanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const storeReport = useOfficeStore(s => s.usageReport);
  const report = storeReport as UsageReport | null;
  const prevReportRef = useRef(storeReport);

  const fetchUsage = useCallback(() => {
    setLoading(true);
    sendCommand({ type: "GET_USAGE", days });
  }, [days]);

  useEffect(() => {
    if (storeReport !== prevReportRef.current) {
      prevReportRef.current = storeReport;
      setLoading(false);
    }
  }, [storeReport]);

  useEffect(() => {
    if (!isOpen) return;
    fetchUsage();
  }, [isOpen, fetchUsage]);

  const availableProviders = report?.providers.filter(p => p.available) ?? [];
  const unavailableProviders = report?.providers.filter(p => !p.available) ?? [];

  return (
    <TermModal open={isOpen} onClose={onClose} title="Usage" maxWidth={520}>
      <div style={{ minHeight: 200 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: "3px 10px",
                fontSize: TERM_SIZE_2XS,
                fontFamily: "monospace",
                background: days === d ? TERM_ACCENT : TERM_SURFACE,
                color: days === d ? TERM_TEXT_BRIGHT : TERM_DIM,
                border: "1px solid " + (days === d ? TERM_ACCENT : TERM_BORDER),
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={fetchUsage}
            disabled={loading}
            style={{
              padding: "3px 10px",
              fontSize: TERM_SIZE_2XS,
              fontFamily: "monospace",
              background: TERM_SURFACE,
              color: TERM_DIM,
              border: `1px solid ${TERM_BORDER}`,
              borderRadius: 4,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "..." : "↻"}
          </button>
        </div>

        {loading && !report && (
          <div style={{ textAlign: "center", padding: 40, opacity: 0.5, fontSize: TERM_SIZE_SM }}>
            Scanning CLI usage data...
          </div>
        )}

        {report && (
          <>
            {(report.totals.inputTokens > 0 || report.totals.outputTokens > 0) && (
              <div style={{
                background: TERM_PANEL,
                border: `1px solid ${TERM_BORDER}`,
                borderRadius: 6,
                padding: "12px 14px",
                marginBottom: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.5 }}>Total tokens ({days}d)</div>
                  <div style={{ fontSize: TERM_SIZE_2XL, fontWeight: 700, fontFamily: "monospace" }}>
                    {fmtTokens(report.totals.inputTokens + report.totals.outputTokens)}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: TERM_SIZE_2XS, opacity: 0.6, lineHeight: "1.6" }}>
                  <div>{fmtTokens(report.totals.inputTokens)} in / {fmtTokens(report.totals.outputTokens)} out</div>
                  <div>{report.totals.sessionCount} sessions</div>
                </div>
              </div>
            )}

            <TokenChart providers={report.providers} />

            {availableProviders.map(p => (
              <ProviderCard
                key={p.provider}
                provider={p}
                expanded={expandedProvider === p.provider}
                onToggle={() => setExpandedProvider(expandedProvider === p.provider ? null : p.provider)}
              />
            ))}

            {unavailableProviders.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: TERM_SIZE_2XS, opacity: 0.4, marginBottom: 6 }}>Not detected</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {unavailableProviders.map(p => (
                    <span key={p.provider} style={{
                      fontSize: TERM_SIZE_2XS,
                      padding: "2px 8px",
                      background: TERM_SURFACE,
                      border: `1px solid ${TERM_BORDER_DIM}`,
                      borderRadius: 4,
                      opacity: 0.4,
                    }}>
                      {p.displayName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: TERM_SIZE_3XS, opacity: 0.3, marginTop: 12, textAlign: "right" }}>
              Scanned at {fmtDate(report.generatedAt)}
            </div>
          </>
        )}
      </div>
    </TermModal>
  );
}
