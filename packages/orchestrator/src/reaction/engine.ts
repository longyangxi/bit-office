import type {
  ReactionTrigger,
  ReactionAction,
  ReactionRule,
  ReactionContext,
  ReactionEngineConfig,
} from "./types.js";

export interface ReactionResult {
  action: ReactionAction | "no-match";
  trigger: ReactionTrigger;
  ruleIndex?: number;
  attempt?: number;
  maxRetries?: number;
}

interface AttemptState {
  count: number;
  errors: string[];
}

export class ReactionEngine {
  private rules: ReactionRule[];
  private attempts = new Map<string, AttemptState>();

  constructor(config: ReactionEngineConfig) {
    this.rules = config.rules;
  }

  private attemptKey(trigger: ReactionTrigger, ctx: ReactionContext): string {
    return `${trigger}:${ctx.agentId}:${ctx.taskId}`;
  }

  private getAttemptState(key: string): AttemptState {
    let state = this.attempts.get(key);
    if (!state) {
      state = { count: 0, errors: [] };
      this.attempts.set(key, state);
    }
    return state;
  }

  private matchesRule(rule: ReactionRule, ctx: ReactionContext): boolean {
    const m = rule.match;
    if (!m) return true;
    if (m.role !== undefined && ctx.role !== m.role) return false;
    if (m.wasTimeout !== undefined && ctx.wasTimeout !== m.wasTimeout) return false;
    if (m.isDelegated !== undefined && ctx.isDelegated !== m.isDelegated) return false;
    if (m.attempt?.gte !== undefined) {
      const key = this.attemptKey(rule.trigger, ctx);
      const state = this.attempts.get(key);
      if (!state || state.count < m.attempt.gte) return false;
    }
    return true;
  }

  handle(trigger: ReactionTrigger, ctx: ReactionContext): ReactionResult {
    // Never retry reviewer failures or cancellations
    if (trigger === "task:failed" && (ctx.isReviewer || ctx.wasCancellation)) {
      return { action: "no-match", trigger };
    }

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (rule.trigger !== trigger) continue;
      if (!this.matchesRule(rule, ctx)) continue;

      const key = this.attemptKey(trigger, ctx);
      const state = this.getAttemptState(key);
      const maxRetries = rule.retries ?? 0;

      // Record the error for history
      if (ctx.error) state.errors.push(ctx.error);

      if (state.count >= maxRetries && rule.escalateAction) {
        const errors = [...state.errors];
        this.attempts.delete(key);
        this.executeAction(rule.escalateAction, ctx, errors);
        return { action: rule.escalateAction, trigger, ruleIndex: i, attempt: state.count, maxRetries };
      }

      state.count++;
      this.executeAction(rule.action, ctx);
      return { action: rule.action, trigger, ruleIndex: i, attempt: state.count, maxRetries };
    }

    return { action: "no-match", trigger };
  }

  private executeAction(action: ReactionAction, ctx: ReactionContext, errorHistory?: string[]): void {
    switch (action) {
      case "retry": {
        const key = this.attemptKey("task:failed", ctx);
        const state = this.attempts.get(key);
        const attempt = state?.count ?? 1;
        const maxRetries = this.rules.find(r => r.trigger === "task:failed")?.retries ?? 2;
        const retryPrompt = this.buildRetryPrompt(ctx, attempt, maxRetries);
        ctx.session.prependTask(ctx.taskId, retryPrompt);
        break;
      }
      case "send-to-agent": {
        if (ctx.devAgentId) {
          ctx.orchestrator.runTask(ctx.devAgentId, ctx.taskId, ctx.reviewerOutput ?? "Fix the issues");
        }
        break;
      }
      case "escalate-to-leader": {
        const lead = ctx.orchestrator.getTeamLead();
        if (lead && lead.getAgentId() !== ctx.agentId) {
          const prompt = this.buildEscalationPrompt(ctx, errorHistory ?? []);
          const escalationTaskId = `escalation-${ctx.taskId}-${Date.now()}`;
          ctx.orchestrator.runTask(lead.getAgentId(), escalationTaskId, prompt);
        }
        break;
      }
      case "notify": {
        ctx.orchestrator.emitNotification({
          title: `Agent ${ctx.agentId} needs attention`,
          message: ctx.error ?? `Trigger: ${ctx.taskId}`,
          priority: "urgent",
          agentId: ctx.agentId,
          taskId: ctx.taskId,
        });
        break;
      }
      case "force-finalize": {
        ctx.orchestrator.forceFinalize(ctx.agentId);
        break;
      }
    }
  }

  private buildRetryPrompt(ctx: ReactionContext, attempt: number, maxRetries: number): string {
    const error = ctx.error ?? "unknown error";
    const original = ctx.originalPrompt ?? "";
    return `${original}

[RETRY — Attempt ${attempt}/${maxRetries}]
Previous attempt failed with:
${error.slice(0, 500)}

Before retrying, follow this protocol:
1. DIAGNOSE: Read the error carefully. Identify the root cause, not just the symptom.
2. FIX: Address the root cause first (missing dependency, wrong path, syntax error, etc.)
3. VERIFY: After fixing, confirm the fix works before moving on.
Do NOT repeat the same approach that failed.`;
  }

  private buildEscalationPrompt(ctx: ReactionContext, errorHistory: string[]): string {
    const errorList = errorHistory.map((e, i) => `  Attempt ${i + 1}: ${e.slice(0, 200)}`).join("\n");
    const sameError = errorHistory.length >= 2 && errorHistory.every(e =>
      e.slice(0, 80).toLowerCase() === errorHistory[0].slice(0, 80).toLowerCase()
    );

    return `[ESCALATION] A task has failed after ${errorHistory.length} attempts and needs your decision.

Original task: "${(ctx.originalPrompt ?? ctx.error ?? "").slice(0, 300)}"

Failure history:
${errorList}
${sameError ? "\nAll attempts failed with the SAME error. This is likely a PERMANENT blocker (missing credentials, API limits, service unavailable). Do NOT reassign — report to user.\n" : ""}
Options (choose ONE):
1. If the error is FIXABLE (code bug, wrong path): Reassign to a DIFFERENT team member with revised instructions
2. If the task is too large: Break into smaller pieces and delegate each part
3. If the error is PERMANENT (auth failure, service down, insufficient balance, missing API key): Report the blocker to the user. Do NOT reassign.

IMPORTANT: If the same error keeps repeating, choose option 3. Do not waste resources retrying.`;
  }

  reset(): void {
    this.attempts.clear();
  }

  clearTask(taskId: string): void {
    for (const key of this.attempts.keys()) {
      if (key.endsWith(`:${taskId}`)) {
        this.attempts.delete(key);
      }
    }
  }
}
