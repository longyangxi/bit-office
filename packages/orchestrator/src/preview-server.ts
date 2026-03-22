import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";

const STATIC_PORT = 9199;
const COMMAND_PORT = 9198;

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
      console.log(`[PreviewServer] Killed orphan process(es) on port ${port}: ${pids.replace(/\n/g, ", ")}`);
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
      this.process = spawn("npx", ["serve", dir, "-l", String(STATIC_PORT), "--no-clipboard"], {
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
      this.process.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[PreviewServer] serve stderr: ${msg.slice(0, 200)}`);
      });
      this.process.unref();
      this.currentDir = dir;
      this.isDetached = true;
      const url = `http://localhost:${STATIC_PORT}/${fileName}`;
      console.log(`[PreviewServer] Serving ${dir} on port ${STATIC_PORT}`);
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
    console.log(`[PreviewServer] Command: "${cmd}" (forced port ${port})`);

    try {
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: "ignore",
        detached: true,
        env: { ...process.env, PORT: String(port) },
      });
      this.process.unref();
      this.currentDir = cwd;
      this.isDetached = true;
      const url = `http://localhost:${port}`;
      console.log(`[PreviewServer] Running "${cmd}" in ${cwd}, preview at port ${port}`);
      return url;
    } catch (e) {
      console.log(`[PreviewServer] Failed to run command: ${e}`);
      return undefined;
    }
  }

  /**
   * Mode 3: Launch a desktop/CLI process (no web preview URL).
   * Used for Pygame, Tkinter, Electron, terminal apps, etc.
   * NOT detached — GUI apps need the login session to access WindowServer (macOS).
   */
  launchProcess(cmd: string, cwd: string): void {
    this.stop();

    try {
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
      });
      this.currentDir = cwd;
      this.isDetached = false;
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
        if (this.isDetached && this.process.pid) {
          process.kill(-this.process.pid, "SIGTERM");
        } else {
          this.process.kill("SIGTERM");
        }
      } catch {
        try { this.process.kill("SIGTERM"); } catch { /* already dead */ }
      }
      this.process = null;
      this.currentDir = null;
      this.isDetached = false;
      console.log(`[PreviewServer] Stopped`);
    }
  }
}

/** Singleton instance */
export const previewServer = new PreviewServer();
