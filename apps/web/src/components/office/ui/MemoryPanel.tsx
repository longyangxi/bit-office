"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { sendCommand } from "@/lib/connection";
import { useOfficeStore } from "@/store/office-store";
import TermModal from "./primitives/TermModal";
import {
  TERM_SURFACE, TERM_BORDER, TERM_BG, TERM_PANEL, TERM_DIM, TERM_TEXT,
  TERM_TEXT_BRIGHT, TERM_ACCENT, TERM_HOVER,
  TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_PURPLE, TERM_SEM_CYAN,
  TERM_SIZE, TERM_SIZE_SM, TERM_SIZE_XS, TERM_SIZE_2XS, TERM_SIZE_3XS,
} from "./termTheme";

/* ── Types ── */

interface SessionSummary {
  timestamp: string;
  what: string;
  decisions: string[];
  filesChanged: string[];
  unfinished: string[];
  commits: string[];
  tokens: { input: number; output: number };
}

interface AgentFact {
  id: string;
  category: string;
  fact: string;
  reinforceCount: number;
  createdAt: string;
  lastSeen: string;
}

interface SharedKnowledge {
  id: string;
  fact: string;
  source: string;
  confirmedBy: string[];
  createdAt: string;
}

type Tab = "sessions" | "facts" | "shared";

const CATEGORY_COLORS: Record<string, string> = {
  user_preference: "cyan",
  codebase_pattern: "green",
  workflow_habit: "yellow",
  lesson_learned: "purple",
};

function getCategoryColor(cat: string): string {
  const key = CATEGORY_COLORS[cat];
  if (key === "cyan") return TERM_SEM_CYAN;
  if (key === "green") return TERM_SEM_GREEN;
  if (key === "yellow") return TERM_SEM_YELLOW;
  if (key === "purple") return TERM_SEM_PURPLE;
  return TERM_DIM;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

/* ── Styles ── */

const S = {
  card: { background: TERM_SURFACE, border: `1px solid ${TERM_BORDER}`, borderRadius: 6, padding: "10px 12px", marginBottom: 8 } as const,
  badge: (color: string) => ({
    display: "inline-block",
    fontSize: TERM_SIZE_3XS,
    padding: "1px 6px",
    borderRadius: 3,
    background: color + "22",
    color,
    fontWeight: 600,
    letterSpacing: "0.03em",
  }),
  deleteBtn: {
    background: "none",
    border: "none",
    color: TERM_DIM,
    cursor: "pointer",
    fontSize: TERM_SIZE_SM,
    padding: "2px 6px",
    borderRadius: 3,
    transition: "color 0.15s, background 0.15s",
    flexShrink: 0,
  } as React.CSSProperties,
  emptyState: {
    textAlign: "center" as const,
    padding: "40px 20px",
    color: TERM_DIM,
    fontSize: TERM_SIZE_XS,
  },
};

/* ── Sub-components ── */

function SessionTimeline({ sessions, filter }: { sessions: SessionSummary[]; filter: string }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    if (!filter) return sessions;
    const q = filter.toLowerCase();
    return sessions.filter(s =>
      s.what.toLowerCase().includes(q) ||
      s.decisions.some(d => d.toLowerCase().includes(q)) ||
      s.filesChanged.some(f => f.toLowerCase().includes(q))
    );
  }, [sessions, filter]);

  if (filtered.length === 0) {
    return <div style={S.emptyState}>No sessions yet - this agent will learn as it works</div>;
  }

  return (
    <div>
      {filtered.map((s, i) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} style={S.card}>
            <div
              onClick={() => {
                const next = new Set(expanded);
                isOpen ? next.delete(i) : next.add(i);
                setExpanded(next);
              }}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: TERM_SIZE_2XS, opacity: 0.4, transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "none" }}>
                {"\u25B6"}
              </span>
              <span style={{ flex: 1, fontSize: TERM_SIZE_SM, color: TERM_TEXT_BRIGHT, fontWeight: 500 }}>
                {s.what}
              </span>
              <span style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM, whiteSpace: "nowrap" }}>
                {fmtDateTime(s.timestamp)}
              </span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 8, fontSize: TERM_SIZE_XS, lineHeight: 1.6 }}>
                {s.decisions.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, marginBottom: 2 }}>Decisions</div>
                    {s.decisions.map((d, j) => (
                      <div key={j} style={{ color: TERM_TEXT, paddingLeft: 8 }}>{"\u2022"} {d}</div>
                    ))}
                  </div>
                )}
                {s.filesChanged.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: TERM_DIM, fontSize: TERM_SIZE_2XS, marginBottom: 2 }}>Files</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {s.filesChanged.map((f, j) => (
                        <span key={j} style={S.badge(TERM_ACCENT)}>{f}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, color: TERM_DIM, fontSize: TERM_SIZE_2XS }}>
                  <span>in: {fmtTokens(s.tokens.input)}</span>
                  <span>out: {fmtTokens(s.tokens.output)}</span>
                  {s.commits.length > 0 && <span>commits: {s.commits.join(", ")}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgentFactsList({
  facts, filter, onDelete,
}: {
  facts: AgentFact[];
  filter: string;
  onDelete: (factId: string) => void;
}) {
  const [sortBy, setSortBy] = useState<"reinforceCount" | "lastSeen">("reinforceCount");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = facts;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(f => f.fact.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) =>
      sortBy === "reinforceCount"
        ? b.reinforceCount - a.reinforceCount
        : new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
  }, [facts, filter, sortBy]);

  if (filtered.length === 0) {
    return <div style={S.emptyState}>{facts.length === 0 ? "No facts yet - this agent will learn as it works" : "No matching facts"}</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM }}>FACTS ({filtered.length})</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["reinforceCount", "lastSeen"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                padding: "2px 8px",
                fontSize: TERM_SIZE_3XS,
                background: sortBy === s ? TERM_ACCENT + "22" : "transparent",
                color: sortBy === s ? TERM_ACCENT : TERM_DIM,
                border: `1px solid ${sortBy === s ? TERM_ACCENT + "44" : TERM_BORDER}`,
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {s === "reinforceCount" ? "Most reinforced" : "Most recent"}
            </button>
          ))}
        </div>
      </div>
      {filtered.map(f => (
        <div key={f.id} style={{ ...S.card, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={S.badge(getCategoryColor(f.category))}>{f.category.replace("_", " ")}</span>
            </div>
            <div style={{ fontSize: TERM_SIZE_SM, color: TERM_TEXT_BRIGHT, lineHeight: 1.5 }}>{f.fact}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: TERM_SIZE_2XS, color: TERM_DIM }}>
              <span>Reinforced {f.reinforceCount}x</span>
              <span>First: {fmtDate(f.createdAt)}</span>
              <span>Last: {fmtDate(f.lastSeen)}</span>
            </div>
          </div>
          {confirmId === f.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <span style={{ fontSize: TERM_SIZE_3XS, color: TERM_SEM_RED }}>Delete?</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => { onDelete(f.id); setConfirmId(null); }}
                  style={{ ...S.deleteBtn, color: TERM_SEM_RED, fontSize: TERM_SIZE_3XS }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  style={{ ...S.deleteBtn, fontSize: TERM_SIZE_3XS }}
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(f.id)}
              style={S.deleteBtn}
              onMouseEnter={e => { e.currentTarget.style.color = TERM_SEM_RED; e.currentTarget.style.background = TERM_SEM_RED + "15"; }}
              onMouseLeave={e => { e.currentTarget.style.color = TERM_DIM; e.currentTarget.style.background = "none"; }}
              title="Delete fact"
            >
              {"\u2715"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SharedKnowledgeList({
  items, filter, agentNames, onDelete,
}: {
  items: SharedKnowledge[];
  filter: string;
  agentNames: Record<string, string>;
  onDelete: (factId: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter(i =>
      i.fact.toLowerCase().includes(q) ||
      (agentNames[i.source] || i.source).toLowerCase().includes(q)
    );
  }, [items, filter, agentNames]);

  if (filtered.length === 0) {
    return <div style={S.emptyState}>{items.length === 0 ? "No shared knowledge yet" : "No matching items"}</div>;
  }

  return (
    <div>
      <div style={{ fontSize: TERM_SIZE_2XS, color: TERM_DIM, marginBottom: 8 }}>SHARED KNOWLEDGE ({filtered.length})</div>
      {filtered.map(item => (
        <div key={item.id} style={{ ...S.card, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: TERM_SIZE_SM, color: TERM_TEXT_BRIGHT, lineHeight: 1.5, marginBottom: 4 }}>{item.fact}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: TERM_SIZE_2XS, color: TERM_DIM }}>
              <span>Source: <span style={{ color: TERM_ACCENT }}>{agentNames[item.source] || item.source}</span></span>
              {item.confirmedBy.length > 0 && (
                <span>
                  Confirmed by:{" "}
                  {item.confirmedBy.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ", "}
                      <span style={{ color: TERM_SEM_CYAN }}>{agentNames[id] || id}</span>
                    </span>
                  ))}
                </span>
              )}
              <span>{fmtDate(item.createdAt)}</span>
            </div>
          </div>
          {confirmId === item.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <span style={{ fontSize: TERM_SIZE_3XS, color: TERM_SEM_RED }}>Delete?</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => { onDelete(item.id); setConfirmId(null); }}
                  style={{ ...S.deleteBtn, color: TERM_SEM_RED, fontSize: TERM_SIZE_3XS }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  style={{ ...S.deleteBtn, fontSize: TERM_SIZE_3XS }}
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(item.id)}
              style={S.deleteBtn}
              onMouseEnter={e => { e.currentTarget.style.color = TERM_SEM_RED; e.currentTarget.style.background = TERM_SEM_RED + "15"; }}
              onMouseLeave={e => { e.currentTarget.style.color = TERM_DIM; e.currentTarget.style.background = "none"; }}
              title="Delete"
            >
              {"\u2715"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main panel ── */

export default function MemoryPanel({
  isOpen, onClose, initialAgentId,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialAgentId?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("sessions");
  const [filter, setFilter] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const agents = useOfficeStore(s => s.agents);
  const memoryL1 = useOfficeStore(s => s.memoryL1);
  const memoryL2 = useOfficeStore(s => s.memoryL2);
  const memoryL3 = useOfficeStore(s => s.memoryL3);
  const factDeleted = useOfficeStore(s => s.factDeleted);

  const prevL1 = useRef(memoryL1);
  const prevL2 = useRef(memoryL2);
  const prevL3 = useRef(memoryL3);

  const agentList = useMemo(() => {
    const list: { id: string; name: string; role: string }[] = [];
    agents.forEach((a, id) => list.push({ id, name: a.name, role: a.role }));
    return list;
  }, [agents]);

  const agentNames = useMemo(() => {
    const m: Record<string, string> = {};
    agents.forEach((a, id) => { m[id] = a.name; });
    return m;
  }, [agents]);

  // Set initial agent
  useEffect(() => {
    if (isOpen) {
      if (initialAgentId) {
        setSelectedAgentId(initialAgentId);
      } else if (!selectedAgentId && agentList.length > 0) {
        setSelectedAgentId(agentList[0].id);
      }
      setFilter("");
    }
  }, [isOpen, initialAgentId, agentList, selectedAgentId]);

  // Fetch data when agent or panel opens
  const fetchData = useCallback(() => {
    if (!selectedAgentId) return;
    setLoading(true);
    sendCommand({ type: "GET_MEMORY_L1", agentId: selectedAgentId });
    sendCommand({ type: "GET_MEMORY_L2", agentId: selectedAgentId });
    sendCommand({ type: "GET_MEMORY_L3" });
  }, [selectedAgentId]);

  useEffect(() => {
    if (!isOpen || !selectedAgentId) return;
    fetchData();
  }, [isOpen, selectedAgentId, fetchData]);

  // Stop loading when data arrives
  useEffect(() => {
    if (memoryL1 !== prevL1.current || memoryL2 !== prevL2.current || memoryL3 !== prevL3.current) {
      prevL1.current = memoryL1;
      prevL2.current = memoryL2;
      prevL3.current = memoryL3;
      setLoading(false);
    }
  }, [memoryL1, memoryL2, memoryL3]);

  // On fact deleted, re-fetch
  useEffect(() => {
    if (factDeleted?.ok) {
      fetchData();
    }
  }, [factDeleted, fetchData]);

  const sessions = (memoryL1?.agentId === selectedAgentId ? memoryL1.sessions : []) as SessionSummary[];
  const facts = (memoryL2?.agentId === selectedAgentId ? memoryL2.facts : []) as AgentFact[];
  const shared = (memoryL3?.items ?? []) as SharedKnowledge[];

  const handleDeleteL2 = useCallback((factId: string) => {
    if (!selectedAgentId) return;
    sendCommand({ type: "DELETE_FACT_L2", agentId: selectedAgentId, factId });
  }, [selectedAgentId]);

  const handleDeleteL3 = useCallback((factId: string) => {
    sendCommand({ type: "DELETE_FACT_L3", factId });
  }, []);

  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : null;
  const titleSuffix = selectedAgent ? `: ${selectedAgent.name}` : "";

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "sessions", label: "Sessions", count: sessions.length },
    { key: "facts", label: "Facts", count: facts.length },
    { key: "shared", label: "Shared", count: shared.length },
  ];

  return (
    <TermModal open={isOpen} onClose={onClose} title={`Agent Memory${titleSuffix}`} maxWidth={580}>
      <div style={{ minHeight: 260 }}>
        {/* Agent selector */}
        <div style={{ marginBottom: 10 }}>
          <select
            value={selectedAgentId || ""}
            onChange={e => setSelectedAgentId(e.target.value || null)}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: TERM_SIZE_SM,
              fontFamily: "inherit",
              background: TERM_BG,
              color: TERM_TEXT_BRIGHT,
              border: `1px solid ${TERM_BORDER}`,
              borderRadius: 4,
              outline: "none",
            }}
          >
            {agentList.map(a => (
              <option key={a.id} value={a.id}>{a.name} - {a.role}</option>
            ))}
          </select>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: "5px 8px",
                fontSize: TERM_SIZE_2XS,
                fontFamily: "inherit",
                background: tab === t.key ? TERM_ACCENT + "22" : "transparent",
                color: tab === t.key ? TERM_ACCENT : TERM_DIM,
                border: `1px solid ${tab === t.key ? TERM_ACCENT + "44" : TERM_BORDER}`,
                borderRadius: 4,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Filter */}
        <div style={{ marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "5px 8px",
              fontSize: TERM_SIZE_SM,
              fontFamily: "inherit",
              background: TERM_BG,
              color: TERM_TEXT,
              border: `1px solid ${TERM_BORDER}`,
              borderRadius: 4,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Content */}
        {loading ? (
          <div style={S.emptyState}>Loading...</div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {tab === "sessions" && (
              <SessionTimeline sessions={sessions} filter={filter} />
            )}
            {tab === "facts" && (
              <AgentFactsList facts={facts} filter={filter} onDelete={handleDeleteL2} />
            )}
            {tab === "shared" && (
              <SharedKnowledgeList items={shared} filter={filter} agentNames={agentNames} onDelete={handleDeleteL3} />
            )}
          </div>
        )}
      </div>
    </TermModal>
  );
}
