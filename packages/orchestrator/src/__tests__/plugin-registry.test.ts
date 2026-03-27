import { describe, it, expect } from "vitest";
import { createPluginRegistry } from "../plugin-registry.js";
import type { PluginSlot } from "../plugin-registry.js";

describe("PluginRegistry", () => {
  it("registers and retrieves a plugin", () => {
    const reg = createPluginRegistry();
    const plugin = { name: "test", doStuff: () => 42 };
    reg.register("agent", "test", plugin);
    expect(reg.get("agent", "test")).toBe(plugin);
  });

  it("returns null for unregistered plugin", () => {
    const reg = createPluginRegistry();
    expect(reg.get("agent", "nonexistent")).toBeNull();
  });

  it("getDefault returns the first registered plugin for a slot", () => {
    const reg = createPluginRegistry();
    const first = { name: "first" };
    const second = { name: "second" };
    reg.register("agent", "first", first);
    reg.register("agent", "second", second);
    expect(reg.getDefault("agent")).toBe(first);
  });

  it("getDefault returns null for empty slot", () => {
    const reg = createPluginRegistry();
    expect(reg.getDefault("notifier")).toBeNull();
  });

  it("lists all manifests for a slot", () => {
    const reg = createPluginRegistry();
    reg.register("agent", "claude", {});
    reg.register("agent", "codex", {});
    reg.register("workspace", "worktree", {});

    const agents = reg.list("agent");
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe("claude");
    expect(agents[1].name).toBe("codex");

    const workspaces = reg.list("workspace");
    expect(workspaces).toHaveLength(1);
  });

  it("does not mix plugins across slots", () => {
    const reg = createPluginRegistry();
    reg.register("agent", "same-name", { type: "agent" });
    reg.register("notifier", "same-name", { type: "notifier" });

    expect(reg.get<{ type: string }>("agent", "same-name")?.type).toBe("agent");
    expect(reg.get<{ type: string }>("notifier", "same-name")?.type).toBe("notifier");
  });

  it("overwrites on re-register", () => {
    const reg = createPluginRegistry();
    reg.register("agent", "x", { v: 1 });
    reg.register("agent", "x", { v: 2 });
    expect(reg.get<{ v: number }>("agent", "x")?.v).toBe(2);
  });
});
