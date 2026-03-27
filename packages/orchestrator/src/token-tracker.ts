/**
 * TokenTracker — self-contained module for tracking token usage and cost.
 *
 * Encapsulates:
 *   - Multi-backend parsing (Claude stream-json, Codex JSONL)
 *   - Dedup by message ID (not signature)
 *   - 4-category token tracking (input, output, cache_read, cache_write)
 *   - Per-model cost calculation
 *   - Pricing tables for Claude + Codex models
 *
 * Integration surface: AgentSession creates a TokenTracker per task,
 * feeds it parsed JSON messages, and reads back the snapshot.
 */

// ── Pricing ─────────────────────────────────────────────────────────

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const CLAUDE_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-4-sonnet": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-3-7-sonnet": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-3-5-sonnet": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-3-5-sonnet-20240620": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-4-opus": { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-3-opus": { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-3-5-haiku": { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.30 },
};
const CLAUDE_DEFAULT: ModelPricing = { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };

const CODEX_PRICING: Record<string, ModelPricing> = {
  "o3": { input: 2, output: 8, cacheRead: 0.50, cacheWrite: 2 },
  "o3-2025-04-16": { input: 2, output: 8, cacheRead: 0.50, cacheWrite: 2 },
  "o4-mini": { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },
  "o4-mini-2025-04-16": { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 1.10 },
  "codex-mini-latest": { input: 1.50, output: 6, cacheRead: 0.375, cacheWrite: 1.50 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.50, cacheWrite: 2 },
  "gpt-4.1-2025-04-14": { input: 2, output: 8, cacheRead: 0.50, cacheWrite: 2 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60, cacheRead: 0.10, cacheWrite: 0.40 },
  "gpt-4.1-mini-2025-04-14": { input: 0.40, output: 1.60, cacheRead: 0.10, cacheWrite: 0.40 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  "gpt-4.1-nano-2025-04-14": { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
};
const CODEX_DEFAULT: ModelPricing = { input: 2.50, output: 10, cacheRead: 0.625, cacheWrite: 2.50 };

function findPricing(model: string, table: Record<string, ModelPricing>, fallback: ModelPricing): ModelPricing {
  if (table[model]) return table[model];
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(table)) {
    if (lower.includes(key) || key.includes(lower)) return pricing;
  }
  return fallback;
}

function costFor(pricing: ModelPricing, input: number, output: number, cacheRead: number, cacheWrite: number): number {
  return (
    (input / 1_000_000) * pricing.input +
    (output / 1_000_000) * pricing.output +
    (cacheRead / 1_000_000) * pricing.cacheRead +
    (cacheWrite / 1_000_000) * pricing.cacheWrite
  );
}

// ── Public types ────────────────────────────────────────────────────

export interface TokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface TokenUsageResult {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

/** What the tracker extracted from a single message (non-token content) */
export interface ParsedContent {
  /** Session ID detected (Claude system msg or Codex session_meta) */
  sessionId?: string;
  /** Text blocks to surface in UI */
  textBlocks: string[];
  /** Thinking text (Claude extended thinking) */
  thinkingBlocks: string[];
  /** Tool uses detected */
  toolUses: Array<{ name: string; input?: Record<string, unknown> }>;
  /** Model name detected from stream */
  model?: string;
}

export type BackendType = "claude" | "codex" | "unknown";

// ── TokenTracker ────────────────────────────────────────────────────

export class TokenTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private costUsd = 0;
  private detectedModel = "";
  private seenIds = new Set<string>();
  private _updated = false;
  private backendType: BackendType;
  /** Whether item.completed already emitted text blocks in the current turn */
  private _turnHasItemText = false;

  constructor(backendId: string) {
    this.backendType = backendId === "claude" ? "claude"
      : backendId === "codex" ? "codex"
      : "unknown";
  }

  /** Reset all state for a new task. */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
    this.costUsd = 0;
    this.detectedModel = "";
    this.seenIds.clear();
    this._updated = false;
    this._turnHasItemText = false;
  }

  /** Current accumulated token snapshot. */
  get snapshot(): TokenSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      costUsd: this.costUsd,
    };
  }

  /** Token usage suitable for event payloads (zeros → undefined). */
  get usage(): TokenUsageResult | undefined {
    if (this.inputTokens === 0 && this.outputTokens === 0) return undefined;
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens || undefined,
      cacheWriteTokens: this.cacheWriteTokens || undefined,
      costUsd: this.costUsd || undefined,
    };
  }

  /** Whether processMessage() updated token counts since last check. Resets on read. */
  consumeUpdate(): boolean {
    const v = this._updated;
    this._updated = false;
    return v;
  }

  /** The model name detected from the stream. */
  get model(): string { return this.detectedModel; }

  /**
   * Process a parsed JSON message from the agent's stdout.
   * Returns extracted non-token content (text, tools, session ID).
   * Token state is updated internally; check consumeUpdate() or snapshot.
   */
  processMessage(msg: Record<string, unknown>): ParsedContent {
    const content: ParsedContent = { textBlocks: [], thinkingBlocks: [], toolUses: [] };

    // ── Claude: system message (session ID) ──
    if (msg.type === "system" && msg.session_id) {
      content.sessionId = msg.session_id as string;
      return content;
    }

    // ── Codex: session_meta ──
    if (msg.type === "session_meta") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.id) content.sessionId = payload.id as string;
      return content;
    }

    // ── Codex: turn_context (model detection) ──
    if (msg.type === "turn_context") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.model) {
        this.detectedModel = payload.model as string;
        content.model = this.detectedModel;
      }
      return content;
    }

    // ── Codex: event_msg (legacy format) ──
    if (msg.type === "event_msg") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return content;
      const payloadType = payload.type as string | undefined;

      if (payloadType === "token_count") {
        const info = payload.info as Record<string, unknown> | undefined;
        if (info) {
          const usage = (info.last_token_usage ?? info.total_token_usage) as Record<string, unknown> | undefined;
          if (usage) {
            const input = (usage.input_tokens as number) ?? 0;
            const output = (usage.output_tokens as number) ?? 0;
            const cached = (usage.cached_input_tokens as number) ?? 0;
            if (input > 0 || output > 0 || cached > 0) {
              this.inputTokens += input;
              this.outputTokens += output;
              this.cacheReadTokens += cached;
              const pricing = findPricing(this.detectedModel || "codex", CODEX_PRICING, CODEX_DEFAULT);
              this.costUsd += costFor(pricing, input, output, cached, 0);
              this._updated = true;
            }
          }
        }
        return content;
      }
      if (payloadType === "agent_message" && typeof payload.message === "string") {
        content.textBlocks.push(payload.message);
        return content;
      }
      if (payloadType === "task_complete") {
        if (typeof payload.last_agent_message === "string") {
          content.textBlocks.push(payload.last_agent_message);
        }
        return content;
      }
      return content;
    }

    // ── Codex: response_item (legacy assistant text) ──
    if (msg.type === "response_item") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.role === "assistant" && Array.isArray(payload.content)) {
        for (const block of payload.content as Record<string, unknown>[]) {
          if (block.type === "output_text" && typeof block.text === "string") {
            content.textBlocks.push(block.text);
          }
        }
      }
      return content;
    }

    // ── Codex v0.105+: Responses API streaming format ──
    // thread.started → session ID
    if (msg.type === "thread.started") {
      const threadId = msg.thread_id as string | undefined;
      if (threadId) content.sessionId = threadId;
      return content;
    }

    // item.completed → reasoning or message content
    if (msg.type === "item.completed") {
      const item = msg.item as Record<string, unknown> | undefined;
      if (!item) return content;
      const itemType = item.type as string | undefined;

      if (itemType === "reasoning" && typeof item.text === "string") {
        // Reasoning text — treat as thinking block (visible in log but not main output)
        content.thinkingBlocks.push(item.text);
        return content;
      }

      if (itemType === "message" && Array.isArray(item.content)) {
        for (const block of item.content as Record<string, unknown>[]) {
          if (block.type === "output_text" && typeof block.text === "string") {
            content.textBlocks.push(block.text);
            this._turnHasItemText = true;
          } else if (block.type === "text" && typeof block.text === "string") {
            content.textBlocks.push(block.text);
            this._turnHasItemText = true;
          }
        }
        return content;
      }

      // function_call_output items — track tool results
      if (itemType === "function_call" && item.name) {
        content.toolUses.push({
          name: item.name as string,
          input: (typeof item.arguments === "string" ? (() => { try { return JSON.parse(item.arguments as string); } catch { return undefined; } })() : undefined),
        });
        return content;
      }

      return content;
    }

    // response.completed → token usage (authoritative totals for the turn)
    if (msg.type === "response.completed") {
      const response = msg.response as Record<string, unknown> | undefined;
      if (response) {
        if (response.model && !this.detectedModel) {
          this.detectedModel = response.model as string;
          content.model = this.detectedModel;
        }
        const usage = response.usage as Record<string, unknown> | undefined;
        if (usage) {
          const input = (usage.input_tokens as number) ?? 0;
          const output = (usage.output_tokens as number) ?? 0;
          const cached = (usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens as number ?? 0;
          if (input > 0 || output > 0) {
            this.inputTokens += input;
            this.outputTokens += output;
            this.cacheReadTokens += cached;
            const pricing = findPricing(this.detectedModel || "codex", CODEX_PRICING, CODEX_DEFAULT);
            this.costUsd += costFor(pricing, input, output, cached, 0);
            this._updated = true;
          }
        }
        // Extract text from response.output[] ONLY if item.completed didn't
        // already provide text blocks (prevents duplicate content in the UI).
        if (!this._turnHasItemText) {
          const output = response.output as Record<string, unknown>[] | undefined;
          if (Array.isArray(output)) {
            for (const item of output) {
              if (item.type === "message" && Array.isArray(item.content)) {
                for (const block of item.content as Record<string, unknown>[]) {
                  if ((block.type === "output_text" || block.type === "text") && typeof block.text === "string") {
                    content.textBlocks.push(block.text);
                  }
                }
              }
            }
          }
        }
        // Reset for next turn
        this._turnHasItemText = false;
      }
      return content;
    }

    // turn.completed — may contain usage summary
    if (msg.type === "turn.completed") {
      return content;
    }

    // ── Claude: assistant message ──
    if (msg.type === "assistant") {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message?.content) return content;

      if (message.model && !this.detectedModel) {
        this.detectedModel = message.model as string;
        content.model = this.detectedModel;
      }

      // Token usage with message ID dedup
      const msgId = (message.id as string) ?? "";
      const reqId = (msg.requestId as string) ?? "";
      const dedupKey = msgId ? `${msgId}:${reqId}` : "";
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage && (!dedupKey || !this.seenIds.has(dedupKey))) {
        if (dedupKey) this.seenIds.add(dedupKey);
        const input = (usage.input_tokens as number) ?? 0;
        const output = (usage.output_tokens as number) ?? 0;
        const cacheRead = (usage.cache_read_input_tokens as number) ?? 0;
        const cacheWrite = (usage.cache_creation_input_tokens as number) ?? 0;
        this.inputTokens += input;
        this.outputTokens += output;
        this.cacheReadTokens += cacheRead;
        this.cacheWriteTokens += cacheWrite;
        const model = this.detectedModel || (message.model as string) || "claude-3-5-sonnet";
        const pricing = findPricing(model, CLAUDE_PRICING, CLAUDE_DEFAULT);
        this.costUsd += costFor(pricing, input, output, cacheRead, cacheWrite);
        this._updated = true;
      }

      // Content blocks
      for (const block of message.content as Record<string, unknown>[]) {
        if (block.type === "text" && typeof block.text === "string") {
          content.textBlocks.push(block.text);
        }
        if (block.type === "thinking" && typeof block.thinking === "string") {
          content.thinkingBlocks.push(block.thinking);
        }
        if (block.type === "tool_use" && block.name) {
          content.toolUses.push({
            name: block.name as string,
            input: block.input as Record<string, unknown> | undefined,
          });
        }
      }
      return content;
    }

    // ── Claude: result message (authoritative session totals) ──
    if (msg.type === "result") {
      const usage = msg.usage as Record<string, unknown> | undefined;
      if (usage) {
        const input = (usage.input_tokens as number) ?? 0;
        const output = (usage.output_tokens as number) ?? 0;
        const cacheRead = (usage.cache_read_input_tokens as number) ?? 0;
        const cacheWrite = (usage.cache_creation_input_tokens as number) ?? 0;
        this.inputTokens = input;
        this.outputTokens = output;
        this.cacheReadTokens = cacheRead;
        this.cacheWriteTokens = cacheWrite;
        const model = this.detectedModel || "claude-3-5-sonnet";
        const pricing = findPricing(model, CLAUDE_PRICING, CLAUDE_DEFAULT);
        this.costUsd = costFor(pricing, input, output, cacheRead, cacheWrite);
        this._updated = true;
      }
      if (typeof msg.result === "string") {
        content.textBlocks.push(msg.result);
      }
      return content;
    }

    return content;
  }
}
