/**
 * Per-model token pricing tables for Claude and Codex.
 * Prices are in USD per million tokens.
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 * Source: https://openai.com/api/pricing
 */

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

export function getClaudePricing(model: string): ModelPricing {
  return findPricing(model, CLAUDE_PRICING, CLAUDE_DEFAULT);
}

export function getCodexPricing(model: string): ModelPricing {
  return findPricing(model, CODEX_PRICING, CODEX_DEFAULT);
}

export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (cacheWriteTokens / 1_000_000) * pricing.cacheWrite
  );
}
