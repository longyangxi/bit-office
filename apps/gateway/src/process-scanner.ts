import { execFile } from "child_process";

/**
 * Known CLI agent commands to detect via process scanning.
 * Only includes distinctive binary names that won't collide with unrelated tools.
 * Ambiguous names (agent, pi, sp) are excluded — they require argv pattern matching
 * handled separately in matchCommand() to avoid false positives.
 */
const KNOWN_COMMANDS = ["claude", "codex", "gemini", "aider", "opencode", "copilot"];

/** Map command name → backend ID (matches BACKEND_OPTIONS in the UI) */
const COMMAND_TO_BACKEND: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  aider: "aider",
  opencode: "opencode",
  copilot: "copilot",
  // Ambiguous names mapped via argv pattern matching (see matchCommand)
  "cursor-agent": "cursor",
  "pi-agent": "pi",
  "sapling-agent": "sapling",
};

/**
 * Argv patterns that disambiguate generic binary names from unrelated tools.
 * Each entry: [regex matching the full argv string, mapped command key].
 * These are checked AFTER the distinctive KNOWN_COMMANDS fail to match.
 */
const AMBIGUOUS_ARGV_PATTERNS: Array<[RegExp, string]> = [
  // Cursor: "agent" binary with cursor-specific flags (--yolo, --model, -p)
  [/(?:^|\/)agent\s+.*(?:--yolo|--model|-p\s)/, "cursor-agent"],
  // Pi: "pi" binary with coding-agent flags (-p, --model)
  [/(?:^|\/)pi\s+.*(?:-p\s|--model\s)/, "pi-agent"],
  // Sapling: "sp" binary with sapling-specific subcommands (run --json)
  [/(?:^|\/)sp\s+run\s/, "sapling-agent"],
];

export interface ExternalAgent {
  pid: number;
  ppid: number;
  cpu: number;
  command: string;
  backendId: string;
  cwd: string | null;
  startedAt: number;
  agentId: string;
  status: "working" | "idle";
}

export interface ScanCallbacks {
  onAdded: (agents: ExternalAgent[]) => void;
  onRemoved: (agentIds: string[]) => void;
  onChanged: (agents: ExternalAgent[]) => void;
}

/** Parse ps etime format [[dd-]hh:]mm:ss into a Date timestamp */
function parseEtime(etime: string): number {
  const now = Date.now();
  const parts = etime.trim().replace(/-/g, ":").split(":");
  let seconds = 0;
  if (parts.length === 4) {
    // dd:hh:mm:ss
    seconds = parseInt(parts[0]) * 86400 + parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
  } else if (parts.length === 3) {
    // hh:mm:ss
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  } else if (parts.length === 2) {
    // mm:ss
    seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return now - seconds * 1000;
}

/** Run a shell command and return stdout */
function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 * 2 }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

/** Get cwd for a list of PIDs using lsof */
async function getCwds(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;

  const output = await exec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"]);
  let currentPid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = parseInt(line.slice(1));
    } else if (line.startsWith("n") && currentPid !== null) {
      result.set(currentPid, line.slice(1));
    }
  }
  return result;
}

export class ProcessScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private previous = new Map<string, ExternalAgent>();
  private getManagedPids: () => number[];
  private callbacks: ScanCallbacks;
  /** PIDs to ignore temporarily (recently killed — may still appear in ps) */
  private graceList = new Map<number, number>(); // pid → expiry timestamp
  private static GRACE_MS = 15_000; // 15 seconds grace period

  constructor(getManagedPids: () => number[], callbacks: ScanCallbacks) {
    this.getManagedPids = getManagedPids;
    this.callbacks = callbacks;
  }

  /** Mark a PID as recently killed — scanner will ignore it for a grace period */
  addGracePid(pid: number): void {
    this.graceList.set(pid, Date.now() + ProcessScanner.GRACE_MS);
  }

  start(intervalMs = 7000) {
    this.scan(); // initial scan
    this.timer = setInterval(() => this.scan(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scan() {
    try {
      const psOutput = await exec("ps", ["-eo", "pid,ppid,pcpu,etime,args"]);
      const managed = new Set(this.getManagedPids());

      // Prune expired grace entries and merge into managed set
      const now = Date.now();
      for (const [pid, expiry] of this.graceList) {
        if (now >= expiry) {
          this.graceList.delete(pid);
        } else {
          managed.add(pid);
        }
      }
      const lines = psOutput.split("\n").slice(1); // skip header

      const candidates: Array<{ pid: number; ppid: number; cpu: number; etime: string; command: string }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Parse: PID PPID %CPU ETIME ARGS...
        const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\w:-]+)\s+(.+)$/);
        if (!match) continue;

        const pid = parseInt(match[1]);
        const ppid = parseInt(match[2]);
        const cpu = parseFloat(match[3]);
        const etime = match[4];
        const args = match[5];

        // Skip managed PIDs (gateway-spawned processes)
        if (managed.has(pid)) continue;

        // Check if args contains one of the known CLI commands
        const cmdName = this.matchCommand(args);
        if (!cmdName) continue;

        candidates.push({ pid, ppid, cpu, etime, command: cmdName });
      }

      // Filter out child processes whose parent is also a candidate
      const candidatePids = new Set(candidates.map(c => c.pid));
      const filtered = candidates.filter(c => !candidatePids.has(c.ppid));

      // Get cwds for all candidates
      const cwds = await getCwds(filtered.map(c => c.pid));

      // Build current state
      const current = new Map<string, ExternalAgent>();
      for (const c of filtered) {
        const backendId = COMMAND_TO_BACKEND[c.command] ?? c.command;
        const agentId = `ext-${backendId}-${c.pid}`;
        const status = c.cpu >= 5 ? "working" : "idle";
        current.set(agentId, {
          pid: c.pid,
          ppid: c.ppid,
          cpu: c.cpu,
          command: c.command,
          backendId,
          cwd: cwds.get(c.pid) ?? null,
          startedAt: parseEtime(c.etime),
          agentId,
          status,
        });
      }

      // Diff with previous
      const added: ExternalAgent[] = [];
      const removed: string[] = [];
      const changed: ExternalAgent[] = [];

      for (const [id, agent] of current) {
        const prev = this.previous.get(id);
        if (!prev) {
          added.push(agent);
        } else if (prev.status !== agent.status) {
          changed.push(agent);
        }
      }

      for (const id of this.previous.keys()) {
        if (!current.has(id)) {
          removed.push(id);
        }
      }

      this.previous = current;

      // Fire callbacks
      if (added.length > 0) this.callbacks.onAdded(added);
      if (removed.length > 0) this.callbacks.onRemoved(removed);
      if (changed.length > 0) this.callbacks.onChanged(changed);
    } catch (err) {
      console.error("[ProcessScanner] Scan error:", err);
    }
  }

  private matchCommand(args: string): string | null {
    // Match command name from the process args
    // args might be: /path/to/claude --flags, or just "claude ..."

    // 1. Check distinctive command names first (safe — no ambiguity)
    for (const cmd of KNOWN_COMMANDS) {
      const re = new RegExp(`(?:^|/)${cmd}(?:\\s|$)`);
      if (re.test(args)) return cmd;
    }

    // 2. Check ambiguous names only with argv pattern disambiguation
    for (const [pattern, mappedKey] of AMBIGUOUS_ARGV_PATTERNS) {
      if (pattern.test(args)) return mappedKey;
    }

    return null;
  }
}
