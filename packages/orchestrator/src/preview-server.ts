import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { homedir } from "os";

const COMMAND_PORT = 9198;

/** Persistent state for command-mode auto-restart across gateway restarts */
const DATA_DIR = path.join(
  homedir(),
  process.env.NODE_ENV === "development" ? ".open-office-dev" : ".open-office",
  "data",
);
const STATE_FILE = path.join(DATA_DIR, "preview-cmd-state.json");

interface CmdState { cmd: string; cwd: string; agentPort: number }

function loadCmdState(): CmdState | null {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, "utf8").trim();
      if (raw) return JSON.parse(raw) as CmdState;
    }
  } catch { /* corrupted or missing */ }
  return null;
}

function saveCmdState(state: CmdState | null): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, state ? JSON.stringify(state) : "", "utf8");
  } catch { /* best effort */ }
}

/**
 * Kill any process occupying a given port.
 * Handles orphaned servers from previous gateway sessions.
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
 * Global preview server — simplified architecture.
 *
 * Static files are served directly by the gateway HTTP handler (zero child processes).
 * Only command-mode previews spawn a child process.
 *
 * The gateway's HTTP server routes:
 *   /preview-static/* → built-in file serving from staticRoot
 *   /preview-app/*    → reverse proxy to COMMAND_PORT
 */
class PreviewServer {
  private process: ChildProcess | null = null;
  private isDetached = false;

  /** Static mode: directory + entry file served directly by gateway HTTP handler */
  private _staticRoot: string | null = null;
  private _staticEntry: string | null = null;

  /** Command mode port */
  readonly commandPort = COMMAND_PORT;

  /** Last command state for auto-restart */
  private lastCmdState: CmdState | null = null;

  // --- Static mode (no child process) ---

  /**
   * Set the static file directory for built-in serving.
   * No child process is spawned — the gateway HTTP handler reads files from disk.
   */
  setStaticDir(filePath: string): boolean {
    if (!existsSync(filePath)) {
      console.log(`[PreviewServer] File not found: ${filePath}`);
      return false;
    }
    this.stopCommand();
    this._staticRoot = path.dirname(filePath);
    this._staticEntry = path.basename(filePath);
    console.log(`[PreviewServer] Static: ${this._staticRoot} (entry: ${this._staticEntry})`);
    return true;
  }

  get staticRoot(): string | null { return this._staticRoot; }
  get staticEntry(): string | null { return this._staticEntry; }

  clearStatic(): void {
    this._staticRoot = null;
    this._staticEntry = null;
  }

  // --- Command mode (spawns child process) ---

  /**
   * Run a command (e.g. "python app.py") on a controlled port.
   * Agent-specified ports are overridden to prevent conflicts.
   */
  runCommand(cmd: string, cwd: string, agentPort: number): string | undefined {
    const originalCmd = cmd;
    this.stopCommand();
    killPortProcess(COMMAND_PORT);

    const port = COMMAND_PORT;
    // Remove existing port flags
    cmd = cmd.replace(/\s+(?:--port|-p)\s+\d+/gi, "");
    // Replace agent port references
    if (agentPort) cmd = cmd.replace(new RegExp(`\\b${agentPort}\\b`, "g"), String(port));
    // Inject --port for JS tools (Python uses PORT env var)
    const isPython = /^python\b|^python3\b/i.test(cmd.trim());
    if (!isPython) {
      cmd = `${cmd} --port ${port}`;
    }

    try {
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: "ignore",
        detached: true,
        env: { ...process.env, PORT: String(port) },
      });
      this.isDetached = true;
      this.lastCmdState = { cmd: originalCmd, cwd, agentPort };
      saveCmdState(this.lastCmdState);
      const url = `http://localhost:${port}`;
      console.log(`[PreviewServer] Running "${cmd}" on :${port} (pid=${this.process?.pid})`);
      return url;
    } catch (e) {
      console.log(`[PreviewServer] Failed to run command: ${e}`);
      return undefined;
    }
  }

  /**
   * Launch a desktop/CLI process (no web preview URL).
   * Used for Pygame, Tkinter, Electron, terminal apps, etc.
   */
  launchProcess(cmd: string, cwd: string): void {
    this.stopCommand();

    try {
      this.process = spawn(cmd, {
        shell: true,
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
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

  /** Stop only the command/launch child process. Static dir is preserved. */
  stopCommand() {
    if (this.process) {
      try {
        if (this.isDetached && this.process.pid) {
          process.kill(-this.process.pid, "SIGTERM");
        } else {
          this.process.kill("SIGTERM");
        }
      } catch { /* already dead */ }
      this.process = null;
      this.isDetached = false;
      console.log(`[PreviewServer] Command stopped`);
    }
  }

  /** Check if the command port is listening. */
  private isPortListening(port: number): boolean {
    try {
      return execSync(`lsof -ti:${port}`, { encoding: "utf8", timeout: 2000 }).trim().length > 0;
    } catch { return false; }
  }

  /**
   * Ensure the command preview server is running.
   * If the process died, auto-restart from persisted state.
   */
  async ensureCommandRunning(): Promise<boolean> {
    if (this.isPortListening(COMMAND_PORT)) return true;

    const state = this.lastCmdState ?? loadCmdState();
    if (!state) {
      console.log(`[PreviewServer] No saved command state to auto-restart from`);
      return false;
    }

    console.log(`[PreviewServer] Command port :${COMMAND_PORT} dead — auto-restarting`);
    const result = this.runCommand(state.cmd, state.cwd, state.agentPort);
    if (!result) return false;

    // Wait for the server to become ready (up to 3s)
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (this.isPortListening(COMMAND_PORT)) return true;
    }
    console.log(`[PreviewServer] Auto-restart timed out for :${COMMAND_PORT}`);
    return false;
  }

  /** Full teardown — stop process, clear static dir, erase persisted state. */
  shutdown() {
    this.stopCommand();
    this.clearStatic();
    this.lastCmdState = null;
    saveCmdState(null);
    console.log(`[PreviewServer] Shutdown`);
  }
}

/** Singleton instance */
export const previewServer = new PreviewServer();
