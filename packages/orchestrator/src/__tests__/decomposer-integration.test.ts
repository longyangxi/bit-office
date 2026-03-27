import { describe, it, expect } from "vitest";
import { tryParseDecomposition } from "../decomposer/index.js";
import { TaskScheduler } from "../decomposer/index.js";
import { selectAgent, type AgentCandidate } from "../agent-selector.js";

describe("Decomposer end-to-end integration", () => {
  const leaderOutput = `I'll coordinate the team to build this.

[DECOMPOSITION]
{
  "tasks": [
    { "id": "dev-1", "role": "Developer", "description": "Build the UI components" },
    { "id": "dev-2", "role": "Developer", "description": "Build the API layer" },
    { "id": "review-1", "role": "Code Reviewer", "description": "Review all code" }
  ],
  "groups": [["dev-1", "dev-2"], ["review-1"]]
}
[/DECOMPOSITION]

The team is ready to go.`;

  const agents: AgentCandidate[] = [
    { agentId: "lead-1", role: "Team Lead", status: "idle", isTeamLead: true },
    { agentId: "dev-a", role: "Developer", status: "idle", isTeamLead: false },
    { agentId: "dev-b", role: "Developer", status: "idle", isTeamLead: false },
    { agentId: "rev-a", role: "Code Reviewer", status: "idle", isTeamLead: false },
  ];

  it("parses leader output into a valid plan", () => {
    const plan = tryParseDecomposition(leaderOutput, "Build full-stack app");
    expect(plan).not.toBeNull();
    expect(plan!.tree.children).toHaveLength(3);
    expect(plan!.groups).toEqual([["dev-1", "dev-2"], ["review-1"]]);
    expect(plan!.tree.kind).toBe("composite");
    expect(plan!.tree.children[0].kind).toBe("atomic");
    expect(plan!.tree.children[0].lineage).toEqual(["Build full-stack app"]);
  });

  it("schedules group 1 tasks concurrently with context", () => {
    const plan = tryParseDecomposition(leaderOutput, "Build full-stack app")!;
    const dispatched: Array<{ taskId: string; context: string }> = [];

    const scheduler = new TaskScheduler(plan, (task, context) => {
      dispatched.push({ taskId: task.id, context });
    });

    scheduler.start();
    expect(dispatched).toHaveLength(2);
    expect(dispatched.map(d => d.taskId).sort()).toEqual(["dev-1", "dev-2"]);

    // Check context injection
    expect(dispatched[0].context).toContain("Task Hierarchy");
    expect(dispatched[0].context).toContain("Build full-stack app");
    expect(dispatched[0].context).toContain("<-- (this task)");
    expect(dispatched[0].context).toContain("Parallel Work");
  });

  it("selects correct agents for each role", () => {
    expect(selectAgent(agents, "Developer")).toBe("dev-a");
    expect(selectAgent(agents, "Code Reviewer")).toBe("rev-a");
    expect(selectAgent(agents, "Team Lead")).toBeNull();
  });

  it("full flow: parse → schedule → select → complete", () => {
    const plan = tryParseDecomposition(leaderOutput, "Build full-stack app")!;
    const agentPool = agents.map(a => ({ ...a })); // clone
    const dispatched: Array<{ taskId: string; agentId: string }> = [];

    const scheduler = new TaskScheduler(plan, (task, _context) => {
      const agentId = selectAgent(agentPool, task.role ?? "Developer");
      expect(agentId).not.toBeNull();
      dispatched.push({ taskId: task.id, agentId: agentId! });
      // Mark agent busy
      const agent = agentPool.find(a => a.agentId === agentId);
      if (agent) agent.status = "working";
    });

    // Start → group 1 (dev-1, dev-2)
    scheduler.start();
    expect(dispatched).toHaveLength(2);
    expect(scheduler.isComplete()).toBe(false);

    // Complete group 1
    agentPool.find(a => a.agentId === dispatched[0].agentId)!.status = "idle";
    scheduler.taskCompleted("dev-1", "UI done");

    agentPool.find(a => a.agentId === dispatched[1].agentId)!.status = "idle";
    scheduler.taskCompleted("dev-2", "API done");

    // Group 2 auto-dispatched (review-1)
    expect(dispatched).toHaveLength(3);
    expect(dispatched[2].taskId).toBe("review-1");

    // Complete review
    scheduler.taskCompleted("review-1", "All good");
    expect(scheduler.isComplete()).toBe(true);
    expect(plan.tree.status).toBe("done");
    expect(plan.phase).toBe("done");
  });

  it("handles failures gracefully", () => {
    const plan = tryParseDecomposition(leaderOutput, "Build full-stack app")!;
    const dispatched: string[] = [];

    const scheduler = new TaskScheduler(plan, (task) => {
      dispatched.push(task.id);
    });

    scheduler.start();
    scheduler.taskCompleted("dev-1", "UI done");
    scheduler.taskFailed("dev-2", "Build error");

    // Group 1 done (even with failure) → group 2 dispatched
    expect(dispatched).toHaveLength(3);

    scheduler.taskCompleted("review-1", "Reviewed with issues");
    expect(scheduler.isComplete()).toBe(true);
    expect(plan.tree.status).toBe("failed"); // because dev-2 failed
  });

  it("single-task decomposition works", () => {
    const singleOutput = `Simple task.
[DECOMPOSITION]
{"tasks": [{"id": "dev-1", "role": "Developer", "description": "Do everything"}], "groups": [["dev-1"]]}
[/DECOMPOSITION]`;

    const plan = tryParseDecomposition(singleOutput, "Simple task")!;
    expect(plan).not.toBeNull();
    expect(plan.tree.children).toHaveLength(1);

    const dispatched: string[] = [];
    const scheduler = new TaskScheduler(plan, (task) => dispatched.push(task.id));
    scheduler.start();
    expect(dispatched).toEqual(["dev-1"]);

    scheduler.taskCompleted("dev-1", "Done");
    expect(scheduler.isComplete()).toBe(true);
    expect(plan.tree.status).toBe("done");
  });
});
