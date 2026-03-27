import { describe, it, expect } from "vitest";
import { selectAgent } from "../agent-selector.js";

const agents = [
  { agentId: "lead-1", role: "Team Lead", status: "idle" as const, isTeamLead: true },
  { agentId: "dev-1", role: "Developer", status: "idle" as const, isTeamLead: false },
  { agentId: "dev-2", role: "Developer", status: "working" as const, isTeamLead: false },
  { agentId: "rev-1", role: "Code Reviewer", status: "idle" as const, isTeamLead: false },
];

describe("selectAgent", () => {
  it("selects idle agent matching role", () => {
    expect(selectAgent(agents, "Developer")).toBe("dev-1");
  });

  it("skips busy agents", () => {
    const allBusy = agents.map(a =>
      a.agentId === "dev-1" ? { ...a, status: "working" as const } : a
    );
    expect(selectAgent(allBusy, "Developer")).toBeNull();
  });

  it("selects reviewer for review role", () => {
    expect(selectAgent(agents, "Code Reviewer")).toBe("rev-1");
  });

  it("never selects team lead", () => {
    expect(selectAgent(agents, "Team Lead")).toBeNull();
  });

  it("falls back to any idle non-lead if no role match", () => {
    expect(selectAgent(agents, "QA Engineer")).toBe("dev-1");
  });

  it("returns null when all agents busy", () => {
    const allBusy = agents.map(a => ({ ...a, status: "working" as const }));
    expect(selectAgent(allBusy, "Developer")).toBeNull();
  });

  it("partial match works (Senior Developer matches Developer)", () => {
    const withSenior = [
      ...agents,
      { agentId: "sr-1", role: "Senior Developer", status: "idle" as const, isTeamLead: false },
    ];
    // Remove the exact-match dev-1 to test partial
    const filtered = withSenior.filter(a => a.agentId !== "dev-1");
    expect(selectAgent(filtered, "Developer")).toBe("sr-1");
  });
});
