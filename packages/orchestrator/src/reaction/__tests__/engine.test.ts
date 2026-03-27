import { describe, it, expect, vi } from "vitest";
import { ReactionEngine } from "../engine.js";
import { DEFAULT_RULES } from "../defaults.js";
import type { ReactionContext, AgentSessionFacade, OrchestratorFacade } from "../types.js";

function mockSession(overrides?: Partial<AgentSessionFacade>): AgentSessionFacade {
  return {
    prependTask: vi.fn(),
    getAgentId: vi.fn(() => "agent-1"),
    getRole: vi.fn(() => "Developer"),
    ...overrides,
  };
}

function mockOrchestrator(overrides?: Partial<OrchestratorFacade>): OrchestratorFacade {
  return {
    getTeamLead: vi.fn(() => null),
    runTask: vi.fn(),
    forceFinalize: vi.fn(),
    emitNotification: vi.fn(),
    ...overrides,
  };
}

function baseContext(overrides?: Partial<ReactionContext>): ReactionContext {
  return {
    agentId: "agent-1",
    taskId: "task-1",
    error: "some error",
    role: "Developer",
    wasTimeout: false,
    wasCancellation: false,
    isDelegated: false,
    session: mockSession(),
    orchestrator: mockOrchestrator(),
    ...overrides,
  };
}

describe("ReactionEngine", () => {
  it("retries a failed task on first attempt", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const session = mockSession();
    const ctx = baseContext({ session });

    const result = engine.handle("task:failed", ctx);

    expect(result.action).toBe("retry");
    expect(result.attempt).toBe(1);
    expect(result.maxRetries).toBe(2);
    expect(session.prependTask).toHaveBeenCalledWith("task-1", expect.stringContaining("[RETRY"));
  });

  it("escalates to leader after retries exhausted", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const leadSession = mockSession({ getAgentId: vi.fn(() => "lead-1") });
    const orchestrator = mockOrchestrator({
      getTeamLead: vi.fn(() => leadSession),
    });
    const ctx = baseContext({ orchestrator, agentId: "agent-1", error: "build error" });

    // Exhaust retries (2 retries allowed)
    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);
    const result = engine.handle("task:failed", ctx);

    expect(result.action).toBe("escalate-to-leader");
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      "lead-1",
      expect.stringContaining("escalation-task-1-"),
      expect.stringContaining("[ESCALATION]"),
    );
  });

  it("skips retry when wasTimeout is true", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ wasTimeout: true });

    const result = engine.handle("task:failed", ctx);

    // The task:failed rule with match: { wasTimeout: false } won't match,
    // so we get no-match
    expect(result.action).toBe("no-match");
  });

  it("skips retry for reviewer agents", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ isReviewer: true });

    const result = engine.handle("task:failed", ctx);

    expect(result.action).toBe("no-match");
  });

  it("skips retry for cancellations", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext({ wasCancellation: true });

    const result = engine.handle("task:failed", ctx);

    expect(result.action).toBe("no-match");
  });

  it("returns attempt count in result", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const ctx = baseContext();

    const result1 = engine.handle("task:failed", ctx);
    expect(result1.attempt).toBe(1);

    const result2 = engine.handle("task:failed", ctx);
    expect(result2.attempt).toBe(2);
  });

  it("resets state on reset()", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const session = mockSession();
    const ctx = baseContext({ session });

    // Use up all retries
    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);

    engine.reset();

    // After reset, should retry again from scratch
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("retry");
    expect(result.attempt).toBe(1);
  });

  it("sends review:fail to dev agent for direct fix", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const orchestrator = mockOrchestrator();
    const ctx = baseContext({
      orchestrator,
      taskId: "review-task-1",
      devAgentId: "dev-agent-1",
      reviewerOutput: "Fix the linting errors",
    });

    const result = engine.handle("review:fail", ctx);

    expect(result.action).toBe("send-to-agent");
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      "dev-agent-1",
      "review-task-1",
      "Fix the linting errors",
    );
  });

  it("force-finalizes on delegation:budget", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const orchestrator = mockOrchestrator();
    const ctx = baseContext({ orchestrator });

    const result = engine.handle("delegation:budget", ctx);

    expect(result.action).toBe("force-finalize");
    expect(orchestrator.forceFinalize).toHaveBeenCalledWith("agent-1");
  });

  it("notifies on agent:stuck", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const orchestrator = mockOrchestrator();
    const ctx = baseContext({ orchestrator, error: "no output for 5 minutes" });

    const result = engine.handle("agent:stuck", ctx);

    expect(result.action).toBe("notify");
    expect(orchestrator.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        taskId: "task-1",
        priority: "urgent",
      }),
    );
  });

  it("escalation prompt includes error history", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const leadSession = mockSession({ getAgentId: vi.fn(() => "lead-1") });
    const orchestrator = mockOrchestrator({
      getTeamLead: vi.fn(() => leadSession),
    });

    const ctx1 = baseContext({ orchestrator, agentId: "agent-1", error: "Error on attempt 1" });
    const ctx2 = baseContext({ orchestrator, agentId: "agent-1", error: "Error on attempt 2" });
    const ctx3 = baseContext({ orchestrator, agentId: "agent-1", error: "Error on attempt 3" });

    engine.handle("task:failed", ctx1);
    engine.handle("task:failed", ctx2);
    engine.handle("task:failed", ctx3);

    const [, , prompt] = (orchestrator.runTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompt).toContain("Attempt 1: Error on attempt 1");
    expect(prompt).toContain("Attempt 2: Error on attempt 2");
    expect(prompt).toContain("Attempt 3: Error on attempt 3");
  });

  it("escalation prompt detects same-error pattern", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const leadSession = mockSession({ getAgentId: vi.fn(() => "lead-1") });
    const orchestrator = mockOrchestrator({
      getTeamLead: vi.fn(() => leadSession),
    });

    const sameError = "ECONNREFUSED connection refused to database";
    const ctx = baseContext({ orchestrator, agentId: "agent-1", error: sameError });

    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);

    const [, , prompt] = (orchestrator.runTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompt).toContain("SAME error");
    expect(prompt).toContain("PERMANENT blocker");
  });

  it("clearTask removes tracking for specific task", () => {
    const engine = new ReactionEngine({ rules: DEFAULT_RULES });
    const session = mockSession();
    const ctx = baseContext({ session, taskId: "task-A" });

    engine.handle("task:failed", ctx);
    engine.handle("task:failed", ctx);

    engine.clearTask("task-A");

    // After clear, retries should restart from scratch
    const result = engine.handle("task:failed", ctx);
    expect(result.action).toBe("retry");
    expect(result.attempt).toBe(1);
  });
});
