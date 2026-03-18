import { useRef, useEffect, useLayoutEffect, memo } from "react";
import { STATUS_CONFIG, BACKEND_OPTIONS } from "./office-constants";
import { TERM_FONT, TERM_SIZE, TERM_GREEN, TERM_DIM, TERM_TEXT_BRIGHT, TERM_GLOW, TERM_BG, TERM_SURFACE } from "./termTheme";
import { isRealEnter } from "./office-utils";
import { SysMsg, TokenBadge } from "./MessageBubble";
import type { ChatMessage } from "@/store/office-store";
import dynamic from "next/dynamic";

const MessageBubble = dynamic(() => import("./MessageBubble"), { ssr: false });

/** Sentinel that triggers loadMore when scrolled into view */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [onLoadMore]);
  return <div ref={ref} style={{ height: 1, flexShrink: 0 }} />;
}

export interface AgentPaneProps {
  agentId: string;
  name: string;
  role?: string;
  backend?: string;
  status: string;
  cwd?: string | null;
  workDir?: string | null;
  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  hasMoreMessages: boolean;
  tokenUsage: { inputTokens: number; outputTokens: number };
  isTeamLead?: boolean;
  isTeamMember: boolean;
  isExternal: boolean;
  teamId?: string;
  teamPhase: string | null;
  pendingApproval: { approvalId: string; title: string; summary: string } | null;
  awaitingApproval?: boolean;
  lastLogLine: string | null;
  busy: boolean;
  pid?: number | null;
  // User role
  isOwner: boolean;
  isCollaborator: boolean;
  isSpectator: boolean;
  // Input state
  prompt: string;
  onPromptChange: (val: string) => void;
  pendingImages: { name: string; dataUrl: string; base64: string }[];
  onPendingImagesChange: (imgs: { name: string; dataUrl: string; base64: string }[]) => void;
  suggestions: { text: string; author: string; timestamp: number }[];
  suggestText: string;
  onSuggestTextChange: (val: string) => void;
  // Callbacks
  onSubmit: () => void;
  onCancel: () => void;
  onFire: (agentId: string) => void;
  onApproval: (approvalId: string, decision: "yes" | "no") => void;
  onApprovePlan: () => void;
  onEndProject: () => void;
  onSuggest: () => void;
  onPreview: (url: string) => void;
  onLoadMore: () => void;
  onPasteImage: (e: React.ClipboardEvent) => void;
  onPasteText: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onDropImage: (e: React.DragEvent) => void;
  onQuickApprove?: () => void;
}

const PHASE_INFO: Record<string, { color: string; icon: string; hint: string }> = {
  create: { color: "#5aacff", icon: "\uD83D\uDCAC", hint: "Chat with your team lead to define the project" },
  design: { color: "#e8b040", icon: "\uD83D\uDCCB", hint: "Review the plan \u2014 approve it or give feedback" },
  execute: { color: "#e89030", icon: "\u26A1", hint: "Team is building your project" },
  complete: { color: "#48cc6a", icon: "\u2713", hint: "Review results \u2014 give feedback or end project" },
};

const AgentPane = memo(function AgentPane(props: AgentPaneProps) {
  const {
    agentId, name, role, backend, status, cwd, workDir,
    messages, visibleMessages, hasMoreMessages,
    tokenUsage, isTeamLead, isTeamMember, isExternal, teamId, teamPhase,
    pendingApproval, awaitingApproval, lastLogLine, busy, pid,
    isOwner, isCollaborator, isSpectator,
    prompt, onPromptChange, pendingImages, onPendingImagesChange,
    suggestions, suggestText, onSuggestTextChange,
    onSubmit, onCancel, onFire, onApproval, onApprovePlan, onEndProject,
    onSuggest, onPreview, onLoadMore, onPasteImage, onPasteText, onDropImage,
    onQuickApprove,
  } = props;

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;

  // ── Scroll management ──
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const msgCount = messages.length;

  // Track scroll position via scroll events
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const onScroll = () => {
      wasAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [agentId]);

  // Scroll to bottom synchronously after DOM commit when messages change
  useLayoutEffect(() => {
    const el = chatEndRef.current;
    const container = el?.parentElement;
    if (container && wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [agentId, msgCount]);

  // MutationObserver for streaming text updates
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (wasAtBottomRef.current) {
            container.scrollTop = container.scrollHeight;
          }
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [agentId]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
    }}>
      {/* ── Info bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 14px",
        background: "rgba(6,10,6,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: `0 1px 0 ${TERM_GREEN}08, inset 0 1px 0 rgba(24,255,98,0.06)`,
        borderBottom: `1px solid ${TERM_GREEN}08`,
        fontSize: 12, fontFamily: TERM_FONT,
        flexShrink: 0,
      }}>
        <span style={{ color: "#c8a050", fontWeight: 600, flexShrink: 0, fontSize: 12 }}>
          {role?.split("\u2014")[0]?.trim()}
          {backend && <span style={{ color: "#8a7040", fontSize: 11 }}> ({BACKEND_OPTIONS.find((b) => b.id === backend)?.name ?? backend})</span>}
        </span>
        {(cwd || workDir) && (
          <span className="term-path-scroll" style={{ fontSize: 11, color: "#7a6848", flexShrink: 1, minWidth: 0 }} title={cwd ?? workDir ?? undefined}>
            {cwd ?? workDir}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: cfg.color, fontSize: 11, flexShrink: 0, fontWeight: 500 }}>{cfg.label}</span>
        {tokenUsage.inputTokens > 0 && <TokenBadge inputTokens={tokenUsage.inputTokens} outputTokens={tokenUsage.outputTokens} />}
        {!teamId && isOwner && (
          <span
            onClick={(e) => { e.stopPropagation(); onFire(agentId); }}
            style={{
              fontSize: 12, color: "#c04040", cursor: "pointer", lineHeight: 1,
              padding: "4px", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ff4040"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#c04040"; }}
          >{"\u2715"}</span>
        )}
      </div>

      {/* ── External agent panel ── */}
      {isExternal && (
        <div style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          backgroundColor: TERM_BG,
          minHeight: 0,
          overflow: "hidden",
        }}>
          {/* Compact info header */}
          <div style={{
            padding: "8px 12px",
            boxShadow: "0 1px 0 rgba(26,42,26,0.5)",
            background: "rgba(10,14,10,0.75)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            flexShrink: 0,
          }}>
            <div style={{ fontSize: TERM_SIZE, color: TERM_GREEN, opacity: 0.6, marginBottom: 4, fontFamily: TERM_FONT, letterSpacing: "0.05em" }}>
              EXTERNAL PROCESS
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT, flexWrap: "wrap" }}>
              <span>{backend ?? "unknown"}</span>
              <span>PID {pid ?? "\u2014"}</span>
              <span className="term-path-scroll" title={cwd ?? undefined} style={{ maxWidth: 300 }}>
                {cwd ?? "\u2014"}
              </span>
            </div>
          </div>

          {/* Scrollable messages */}
          <div className="crt-screen" style={{
            flex: 1, overflowY: "auto", padding: "8px 10px",
            display: "flex", flexDirection: "column",
            minHeight: 0,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 13 }}>
                Waiting for output...
              </div>
            )}
            {hasMoreMessages && <LoadMoreSentinel onLoadMore={onLoadMore} />}
            {visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentName={name} />
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Read-only footer */}
          <div style={{
            padding: "6px 12px",
            backgroundColor: TERM_SURFACE,
            fontSize: TERM_SIZE, color: TERM_DIM, fontFamily: TERM_FONT,
            textAlign: "center", flexShrink: 0,
          }}>
            Read-only — this process is running externally
          </div>
        </div>
      )}

      {/* ── Normal agent panel ── */}
      {!isExternal && (
        <div
          onPaste={onPasteImage}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.currentTarget.style.outline = "2px solid #e8b04060"; } }}
          onDragLeave={(e) => { e.currentTarget.style.outline = "none"; }}
          onDrop={(e) => { e.currentTarget.style.outline = "none"; onDropImage(e); }}
          className="crt-screen"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            backgroundColor: TERM_BG,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Messages */}
          <div className="term-dotgrid term-chat-area" style={{
            flex: 1, overflowY: "auto", padding: "10px 14px",
            display: "flex", flexDirection: "column",
            minHeight: 0,
          }}>
            {/* Phase banner for team leads */}
            {isTeamLead && (() => {
              if (!teamPhase) return null;
              const info = PHASE_INFO[teamPhase];
              if (!info) return null;
              return (
                <div style={{
                  padding: "6px 10px", marginBottom: 8,
                  backgroundColor: info.color + "10",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                  border: `1px solid ${info.color}30`,
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontFamily: "monospace",
                }}>
                  <span>{info.icon}</span>
                  <span style={{ color: info.color, fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>{teamPhase}</span>
                  <span style={{ color: "#7a6858" }}>{info.hint}</span>
                </div>
              );
            })()}

            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "#5a4838", padding: 20, fontSize: 13 }}>
                {isTeamMember ? "This agent is managed by the Team Lead" : "Send a message to get started"}
              </div>
            )}

            {hasMoreMessages && <LoadMoreSentinel onLoadMore={onLoadMore} />}
            {visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentName={name} onPreview={onPreview} isTeamLead={isTeamLead} isTeamMember={isTeamMember} teamPhase={isTeamLead ? teamPhase : null} />
            ))}

            {pendingApproval && (
              <div style={{
                marginBottom: 8, padding: 12,
                backgroundColor: "#261a00",
                border: "1px solid #e89030",
              }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: "#e89030", marginBottom: 6, fontFamily: "monospace" }}>
                  {"\u25B2"} {pendingApproval.title}
                </div>
                <div style={{ fontSize: 13, color: "#b89868", marginBottom: 10, lineHeight: 1.5 }}>
                  {pendingApproval.summary}
                </div>
                {isOwner && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="term-btn"
                      onClick={() => onApproval(pendingApproval.approvalId, "yes")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #48cc6a", backgroundColor: "#143a14", color: "#48cc6a", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >{"\u25B6"} Approve</button>
                    <button
                      className="term-btn"
                      onClick={() => onApproval(pendingApproval.approvalId, "no")}
                      style={{ flex: 1, padding: "8px", border: "1px solid #e04848", backgroundColor: "#3e1818", color: "#e04848", cursor: "pointer", fontWeight: "bold", fontSize: 12, fontFamily: "monospace" }}
                    >{"\u2715"} Reject</button>
                  </div>
                )}
              </div>
            )}

            {busy && !pendingApproval && messages.length > 0 && messages[messages.length - 1]?.text && (
              <div style={{ padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: TERM_GREEN, opacity: 0.5 }} className="working-dots"><span className="working-dots-mid" /></span>
                {lastLogLine && (
                  <span style={{ color: TERM_DIM, fontSize: 10, fontFamily: TERM_FONT, opacity: 0.6 }}>
                    {lastLogLine.slice(0, 60)}
                  </span>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Suggestion feed (visible to owner and collaborator) */}
          {!isSpectator && suggestions.length > 0 && (
            <div style={{
              padding: "6px 10px", borderTop: "1px solid #152515",
              backgroundColor: "#0a0e0a", maxHeight: 120, overflowY: "auto",
            }}>
              <div style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>SUGGESTIONS</div>
              {suggestions.slice(-10).map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: "#c084fc", marginBottom: 2, lineHeight: 1.4 }}>
                  <span style={{ color: "#7c3aed", fontWeight: 600 }}>{s.author}:</span> {s.text}
                </div>
              ))}
            </div>
          )}

          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div style={{
              padding: "6px 10px", borderTop: "1px solid #152515",
              backgroundColor: "#0a0e0a", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
            }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position: "relative", display: "inline-block" }}>
                  <img src={img.dataUrl} alt={img.name} style={{ height: 48, borderRadius: 4, border: "1px solid #1a2a1a" }} />
                  <button
                    onClick={() => onPendingImagesChange(pendingImages.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: -4, right: -4,
                      width: 16, height: 16, borderRadius: "50%",
                      border: "none", backgroundColor: "#e04848", color: "#fff",
                      fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 0, lineHeight: 1,
                    }}
                  >{"\u00d7"}</button>
                </div>
              ))}
              <span style={{ fontSize: 10, color: "#7a6858", fontFamily: "monospace" }}>
                {pendingImages.length} image{pendingImages.length > 1 ? "s" : ""} attached
              </span>
            </div>
          )}

          {/* ── Input / Cancel ── */}
          {(() => {
            const cardPhase = isTeamLead ? teamPhase : null;

            // Spectator: read-only footer
            if (isSpectator) {
              return (
                <div style={{
                  padding: "8px 10px", borderTop: "1px solid #152515",
                  backgroundColor: "#182844", flexShrink: 0,
                  fontSize: 12, color: "#7ab8f5", fontFamily: "monospace", textAlign: "center",
                }}>
                  Watching — read-only mode
                </div>
              );
            }

            // Collaborator: suggest input only
            if (isCollaborator) {
              return (
                <div style={{
                  padding: "8px 10px", borderTop: "1px solid #152515",
                  background: "rgba(10,14,10,0.8)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  flexShrink: 0,
                }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={suggestText}
                      onChange={(e) => onSuggestTextChange(e.target.value)}
                      onKeyDown={(e) => isRealEnter(e) && onSuggest()}
                      placeholder="Share an idea..."
                      maxLength={500}
                      style={{
                        flex: 1, padding: "9px 12px", border: "1px solid #7c3aed40",
                        backgroundColor: "#16122a", color: "#c084fc", fontSize: 14, outline: "none",
                      }}
                    />
                    <button
                      onClick={onSuggest}
                      disabled={!suggestText.trim()}
                      style={{
                        padding: "9px 14px", border: "none",
                        backgroundColor: suggestText.trim() ? "#a855f7" : "#0e1a0e",
                        color: suggestText.trim() ? "#fff" : "#5a4838",
                        fontSize: 13, cursor: suggestText.trim() ? "pointer" : "default",
                        fontWeight: 700, fontFamily: "monospace",
                      }}
                    >Suggest</button>
                  </div>
                </div>
              );
            }

            // Owner input area
            return (
              <div style={{
                padding: "8px 12px",
                borderTop: `1px solid ${TERM_GREEN}10`,
                background: "rgba(6,10,6,0.85)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: `0 -1px 8px rgba(0,0,0,0.2), inset 0 1px 0 ${TERM_GREEN}06`,
                flexShrink: 0,
              }}>
                {isTeamMember ? (
                  <div style={{
                    textAlign: "center", color: "#5a4838", fontSize: 12, padding: "8px 0", fontFamily: "monospace",
                  }}>
                    Tasks are assigned by the Team Lead
                  </div>
                ) : cardPhase === "execute" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div style={{ display: "flex", gap: 0, alignItems: "center", borderTop: "none" }}>
                      <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: busy ? "none" : TERM_GLOW }}>&gt;</span>
                      <input
                        className="term-input"
                        value={prompt}
                        onPaste={onPasteText}
                        onChange={(e) => onPromptChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape" && busy) { onCancel(); return; }
                          if (isRealEnter(e)) onSubmit();
                        }}
                        placeholder={busy ? "esc stop \u00b7 type to continue" : ""}
                        style={{
                          flex: 1, padding: "6px 5px", border: "none",
                          backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                          fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                        }}
                      />
                    </div>
                    {!busy && (
                      <span
                        onClick={onEndProject}
                        style={{ padding: "2px 8px 4px", color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: TERM_FONT }}
                      >close project</span>
                    )}
                  </div>
                ) : cardPhase === "design" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "none", padding: "4px 8px" }}>
                    <button
                      className="term-btn"
                      onClick={onApprovePlan}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT,
                      }}
                    >approve</button>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
                    <input
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => onPromptChange(e.target.value)}
                      onKeyDown={(e) => isRealEnter(e) && onSubmit()}
                      placeholder="or give feedback..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                      }}
                    />
                  </div>
                ) : cardPhase === "complete" && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "none", padding: "4px 8px" }}>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
                    <input
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => onPromptChange(e.target.value)}
                      onKeyDown={(e) => isRealEnter(e) && onSubmit()}
                      placeholder="request changes..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                      }}
                    />
                    <button
                      onClick={onEndProject}
                      style={{
                        padding: "5px 14px", border: "1px solid #e8903040",
                        backgroundColor: "transparent", color: "#e89030", fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT, flexShrink: 0,
                      }}
                    >Close Project</button>
                  </div>
                ) : awaitingApproval && !busy ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "none", padding: "4px 8px" }}>
                    <button
                      className="term-btn"
                      onClick={onQuickApprove}
                      style={{
                        padding: "5px 14px", border: `1px solid ${TERM_GREEN}60`,
                        backgroundColor: "transparent", color: TERM_GREEN, fontSize: TERM_SIZE, cursor: "pointer",
                        fontFamily: TERM_FONT,
                      }}
                    >approve</button>
                    <span style={{ color: TERM_DIM, fontSize: TERM_SIZE, fontFamily: TERM_FONT }}>&gt;</span>
                    <input
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => onPromptChange(e.target.value)}
                      onKeyDown={(e) => isRealEnter(e) && onSubmit()}
                      placeholder="or give feedback..."
                      style={{
                        flex: 1, padding: "5px 6px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, caretColor: TERM_GREEN,
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 0, alignItems: "center", borderTop: "none" }}>
                    <span style={{ color: busy ? TERM_DIM : TERM_GREEN, fontSize: TERM_SIZE, fontFamily: TERM_FONT, padding: "6px 0 6px 8px", flexShrink: 0, textShadow: busy ? "none" : TERM_GLOW }}>&gt;</span>
                    <input
                      className="term-input"
                      value={prompt}
                      onPaste={onPasteText}
                      onChange={(e) => onPromptChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && busy) { onCancel(); return; }
                        if (isRealEnter(e)) onSubmit();
                      }}
                      placeholder={busy ? "esc stop \u00b7 type to continue" : ""}
                      style={{
                        flex: 1, padding: "6px 5px", border: "none",
                        backgroundColor: "transparent", color: TERM_TEXT_BRIGHT, fontSize: TERM_SIZE, outline: "none",
                        fontFamily: TERM_FONT, fontWeight: 400, caretColor: TERM_GREEN,
                      }}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
});

export default AgentPane;
