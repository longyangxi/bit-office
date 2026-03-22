import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";

const STATIC_PORT = 9199;
const COMMAND_PORT = 9198;

/**
 * Resolve the `serve` binary — prefer direct `serve` over `npx serve`
 * because npx/npm may not be installed (e.g. node installed via standalone binary).
 */
function resolveServeBin(): { cmd: string; args: (dir: string, port: number) => string[] } {
  // 1. Try direct `serve` — validate it's the npm @vercel/serve CLI (supports --help)
  try {
    const servePath = execSync("which serve", { encoding: "utf8", timeout: 3000 }).trim();
    if (servePath) {
      // Verify it's the expected `serve` by checking its --help output for known flags
      const helpOutput = execSync(`${servePath} --help 2>&1`, { encoding: "utf8", timeout: 5000 });
      if (helpOutput.includes("--listen") || helpOutput.includes("-l")) {
        return {
          cmd: servePath,
          args: (dir, port) => [dir, "-l", String(port), "--no-clipboard"],
        };
      }
    }
  } catch { /* not found or validation failed */ }

  // 2. Fallback to npx serve
  return {
    cmd: "npx",
    args: (dir, port) => ["serve", dir, "-l", String(port), "--no-clipboard"],
  };
}

/**
 * Kill any process occupying a given port.
 * Handles orphaned servers from previous gateway sessions that survived restart.
 */
function killPortProcess(port: number): void {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: "utf8", timeout: 3000 }).trim();
    if (pids) {
      for (const pid of pids.split("\n")) {
        try { process.kill(Number(pid), "SIGKILL"); } catch { /* already dead */ }
      }
      console.log(`[PreviewServer] Killed orphan on :${port} (pids: ${pids.replace(/\n/g, ", ")})`);
    }
  } catch { /* no process on port — expected */ }
}

/**
 * Global preview server — one at a time.
 * Supports two modes:
 *   1. Static file serving (npx serve) for HTML/CSS/JS and framework build output
 *   2. Command execution (python app.py, node server.js) for dynamic apps
 *
 * Port allocation is fully controlled by this server — agent-specified ports
 * are always overridden to prevent conflicts with the host system.
 */
class PreviewServer {
  private process: ChildProcess | null = null;
  private currentDir: string | null = null;
  /** true when spawned with detached:true (needs process-group kill) */
  private isDetached = false;

  /**
   * Mode 1: Serve a static file directory on a fixed port.
   * Returns the preview URL for the given file.
   */
  serve(filePath: string): string | undefined {
    if (!existsSync(filePath)) {
      console.log(`[PreviewServer] File not found: ${filePath}`);
      return undefined;
    }
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);

    this.stop();
    killPortProcess(STATIC_PORT);

    try {
      const serve = resolveServeBin();
      const serveArgs = serve.args(dir, STATIC_PORT);
      // detached: true creates a process group so stop() can kill the whole tree
      // (needed for npx wrapper which spawns a child `serve` process).
      // NOT using .unref() — so Node tracks the child and it dies on gateway exit.
      this.process = spawn(serve.cmd, serveArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
      this.process.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[PreviewServer] stderr: ${msg.slice(0, 200)}`);
      });
      this.process.on("error", (err) => {
        console.log(`[PreviewServer] ERROR: ${err.message}`);
      });
      this.currentDir = dir;
      this.isDetached = true;
      const url = `http://localhost:${STATIC_PORT}/${fileName}`;
      console.log(`[PreviewServer] Serving ${dir} on :${STATIC_PORT} (pid=${this.process.pid})`);
      return url;
    } catch (e) {
      console.log(`[PreviewServer] Failed to start static serve: ${e}`);
      return undefined;
    }
  }

  /**
   * Mode 2: Run a command (e.g. "python app.py") and use a controlled port.
   * The agent-specified port is ALWAYS replaced with COMMAND_PORT to prevent
   * conflicts with the host system (e.g. Next.js on 3000).
   * Returns the preview URL.
   */
  runCommand(cmd: string, cwd: string, agentPort: number): string | undefined {
    this.stop();
    killPortProcess(COMMAND_PORT);

    // Always use our controlled port — override agent-specified ports to prevent conflicts.
    const port = COMMAND_PORT;
    // Remove any existing --port/--Port/-p flags with their values
    cmd = cmd.replace(/\s+(?:--port|-p)\s+\d+/gi, "");
    // Remove the agent port number if it appears as a bare argument (e.g. "serve -l 5173")
    if (agentPort) cmd = cmd.replace(new RegExp(`\\b${agentPort}\\b`, "g"), String(port));
    // Inject --port flag for tools that support it (JS ecosystem).
    // Python commands don't accept --port — they use PORT env var instead.
    const isPython = /^python\b|^python3\b/i.test(cmd.trim());
    if (!isPython) {
      cmd = `${cmd} --port ${port}`;
    }
    try {
      // detached: true so stop() can kill the entire process group (shell + children)
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: "ignore",
        detached: true,
        env: { ...process.env, PORT: String(port) },
      });
      this.currentDir = cwd;
      this.isDetached = true;
      const url = `http://localhost:${port}`;
      console.log(`[PreviewServer] Running "${cmd}" on :${port} (pid=${this.process?.pid})`);
      return url;
    } catch (e) {
      console.log(`[PreviewServer] Failed to run command: ${e}`);
      return undefined;
    }
  }

  /**
   * Mode 3: Launch a desktop/CLI process (no web preview URL).
   * Used for Pygame, Tkinter, Electron, terminal apps, etc.
   */
  launchProcess(cmd: string, cwd: string): void {
    this.stop();

    try {
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
      this.currentDir = cwd;
      this.isDetached = true;
      console.log(`[PreviewServer] Launched "${cmd}" in ${cwd} (pid=${this.process.pid})`);
      this.process.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[PreviewServer] stderr: ${msg.slice(0, 200)}`);
      });
      this.process.on("exit", (code) => {
        console.log(`[PreviewServer] Process exited with code ${code}`);
      });
    } catch (e) {
      console.log(`[PreviewServer] Failed to launch process: ${e}`);
    }
  }

  /** Stop the current preview process and ensure port is released */
  stop() {
    if (this.process) {
      try {
        // Kill entire process group (shell + children) when detached
        if (this.isDetached && this.process.pid) {
          process.kill(-this.process.pid, "SIGTERM");
        } else {
          this.process.kill("SIGTERM");
        }
      } catch { /* already dead */ }
      this.process = null;
      this.currentDir = null;
      this.isDetached = false;
      console.log(`[PreviewServer] Stopped`);
    }
  }
}

/** Singleton instance */
export const previewServer = new PreviewServer();
