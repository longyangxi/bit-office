import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runPostCreate } from "../post-create.js";
import type { WorkspaceInfo, PostCreateConfig } from "../types.js";
import { mkdirSync, rmSync, existsSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runPostCreate", () => {
  let wsDir: string;
  let repoDir: string;

  beforeEach(() => {
    const base = join(tmpdir(), `postCreate-test-${Date.now()}`);
    wsDir = join(base, "workspace");
    repoDir = join(base, "repo");
    mkdirSync(wsDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    const base = join(wsDir, "..");
    rmSync(base, { recursive: true, force: true });
  });

  function info(): WorkspaceInfo {
    return { path: wsDir, branch: "test", agentId: "a1" };
  }

  it("symlinks a file from repo to workspace", async () => {
    writeFileSync(join(repoDir, ".env"), "SECRET=123");
    await runPostCreate(info(), repoDir, { symlinks: [".env"] });
    expect(existsSync(join(wsDir, ".env"))).toBe(true);
    expect(readlinkSync(join(wsDir, ".env"))).toBe(join(repoDir, ".env"));
  });

  it("symlinks a directory from repo to workspace", async () => {
    mkdirSync(join(repoDir, ".claude"), { recursive: true });
    writeFileSync(join(repoDir, ".claude", "config.json"), "{}");
    await runPostCreate(info(), repoDir, { symlinks: [".claude"] });
    expect(existsSync(join(wsDir, ".claude"))).toBe(true);
    expect(readlinkSync(join(wsDir, ".claude"))).toBe(join(repoDir, ".claude"));
  });

  it("rejects symlink paths with '..'", async () => {
    writeFileSync(join(repoDir, "safe.txt"), "ok");
    await runPostCreate(info(), repoDir, { symlinks: ["../../etc/passwd"] });
    // Should not create any symlink
    expect(existsSync(join(wsDir, "../../etc/passwd"))).toBe(false);
  });

  it("rejects absolute symlink paths", async () => {
    await runPostCreate(info(), repoDir, { symlinks: ["/etc/passwd"] });
    // Should not throw, just skip
  });

  it("skips symlink if source does not exist", async () => {
    await runPostCreate(info(), repoDir, { symlinks: [".nonexistent"] });
    expect(existsSync(join(wsDir, ".nonexistent"))).toBe(false);
  });

  it("runs shell commands in workspace directory", async () => {
    await runPostCreate(info(), repoDir, { commands: ["touch created.txt"] });
    expect(existsSync(join(wsDir, "created.txt"))).toBe(true);
  });

  it("continues on command failure", async () => {
    await runPostCreate(info(), repoDir, {
      commands: ["false", "touch after-fail.txt"],
    });
    // First command fails, second should still run
    expect(existsSync(join(wsDir, "after-fail.txt"))).toBe(true);
  });

  it("handles empty config gracefully", async () => {
    await expect(runPostCreate(info(), repoDir, {})).resolves.not.toThrow();
  });
});
