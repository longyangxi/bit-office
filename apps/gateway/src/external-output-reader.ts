import { watch, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "fs";
import { execFile } from "child_process";
import path from "path";
import os from "os";

type OutputCallback = (line: string) => void;
type StatusCallback = (agentId: string, status: "working" | "idle") => void;
type TokenUpdateCallback = (agentId: string, inputTokens: number, outputTokens: number) => void;

interface ReaderState {
  agentId: string;
  pid: number;
  cwd: string | null;
  backendId: string;
  onOutput: OutputCallback;
  cleanup: () => void;
  inputTokens: number;
  outputTokens: number;
}

/** Source file extensions for lsof fallback */
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp",
  ".h", ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".toml", ".md",
  ".sql", ".sh", ".rb", ".swift", ".kt",
]);

/**
 * Reads output from external CLI agent processes.
 *
 * - Claude: watches JSONL session transcripts in ~/.claude/projects/
 * - Others: runs lsof periodically to detect file activity
 */
export class ExternalOutputReader {
  private readers = new Map<string, ReaderState>();
  private onStatus: StatusCallback | null = null;
  private onTokenUpdate: TokenUpdateCallback | null = null;

  /** Set a callback to be notified when an external agent's status changes (driven by JSONL entries) */
  setOnStatus(cb: StatusCallback): void {
    this.onStatus = cb;
  }

  /** Set a callback to be notified when token usage is detected from JSONL entries */
  setOnTokenUpdate(cb: TokenUpdateCallback): void {
    this.onTokenUpdate = cb;
  }

  attach(
    agentId: string,
    pid: number,
    cwd: string | null,
    backendId: string,
    onOutput: OutputCallback,
  ): void {
    if (this.readers.has(agentId)) return;

    let cleanup: () => void;

    if (backendId === "claude" && cwd) {
      cleanup = this.startClaudeReader(agentId, cwd, onOutput);
    } else {
      cleanup = this.startLsofReader(agentId, pid, onOutput);
    }

    this.readers.set(agentId, { agentId, pid, cwd, backendId, onOutput, cleanup, inputTokens: 0, outputTokens: 0 });
  }

  detach(agentId: string): void {
    const reader = this.readers.get(agentId);
    if (reader) {
      reader.cleanup();
      this.readers.delete(agentId);
    }
  }

  detachAll(): void {
    for (const [id] of this.readers) {
      this.detach(id);
    }
  }

  // ── Claude JSONL reader ───────────────────────────────────────

  private startClaudeReader(
    agentId: string,
    cwd: string,
    onOutput: OutputCallback,
  ): () => void {
    // Claude stores sessions in ~/.claude/projects/{key}/*.jsonl
    // Key: cwd with "/" replaced by "-" — keeps the leading dash
    // e.g. /Users/foo/project → -Users-foo-project
    const projectKey = cwd.replace(/\//g, "-");
    const projectDir = path.join(os.homedir(), ".claude", "projects", projectKey);

    console.log(`[OutputReader] Claude reader for ${agentId}: watching ${projectDir}`);

    let lastPosition = 0;
    let watchedFile: string | null = null;
    let watcher: ReturnType<typeof watch> | null = null;
    let lastEmitTime = 0;
    let pendingChunk: string | null = null;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let retryCount = 0;

    const THROTTLE_MS = 2000;
    const POLL_MS = 3000; // Fallback poll interval (fs.watch can be unreliable on macOS)
    const MAX_RETRIES = 5;

    const emitThrottled = (text: string) => {
      const now = Date.now();
      if (now - lastEmitTime >= THROTTLE_MS) {
        lastEmitTime = now;
        onOutput(text);
        pendingChunk = null;
      } else {
        pendingChunk = text;
        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            if (pendingChunk && !stopped) {
              lastEmitTime = Date.now();
              onOutput(pendingChunk);
              pendingChunk = null;
            }
          }, THROTTLE_MS - (now - lastEmitTime));
        }
      }
    };

    const readNewLines = () => {
      if (!watchedFile || stopped) return;
      try {
        const stat = statSync(watchedFile);
        if (stat.size <= lastPosition) return;

        const bytesToRead = stat.size - lastPosition;
        const buf = Buffer.alloc(bytesToRead);
        const fd = openSync(watchedFile, "r");
        try {
          readSync(fd, buf, 0, bytesToRead, lastPosition);
        } finally {
          closeSync(fd);
        }
        lastPosition = stat.size;

        const newData = buf.toString("utf-8");
        for (const line of newData.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            this.extractClaudeOutput(entry, emitThrottled, agentId);
          } catch {
            // Skip malformed lines
          }
        }
      } catch (err) {
        console.error(`[OutputReader] Error reading JSONL for ${agentId}:`, err);
      }
    };

    const findAndWatch = () => {
      if (stopped) return;
      if (!existsSync(projectDir)) {
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          console.log(`[OutputReader] Project dir not found after ${MAX_RETRIES} retries, giving up: ${projectDir}`);
          return;
        }
        console.log(`[OutputReader] Project dir not found (${retryCount}/${MAX_RETRIES}), retrying: ${projectDir}`);
        retryTimer = setTimeout(findAndWatch, 5000);
        return;
      }

      try {
        const files = readdirSync(projectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({
            name: f,
            mtime: statSync(path.join(projectDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length === 0) {
          retryCount++;
          if (retryCount > MAX_RETRIES) {
            console.log(`[OutputReader] No JSONL files after ${MAX_RETRIES} retries, giving up: ${projectDir}`);
            return;
          }
          console.log(`[OutputReader] No JSONL files yet in ${projectDir} (${retryCount}/${MAX_RETRIES}), retrying`);
          retryTimer = setTimeout(findAndWatch, 5000);
          return;
        }

        watchedFile = path.join(projectDir, files[0].name);
        // Start reading from end of file (only new content)
        lastPosition = statSync(watchedFile).size;
        console.log(`[OutputReader] Watching JSONL: ${watchedFile} (pos=${lastPosition})`);

        // Use fs.watch for immediate notifications
        try {
          watcher = watch(projectDir, (_event, filename) => {
            if (stopped) return;
            // If a newer JSONL appears, switch to it
            if (filename && filename.endsWith(".jsonl")) {
              const fullPath = path.join(projectDir, filename);
              if (fullPath !== watchedFile && existsSync(fullPath)) {
                try {
                  const newMtime = statSync(fullPath).mtimeMs;
                  const curMtime = watchedFile ? statSync(watchedFile).mtimeMs : 0;
                  if (newMtime > curMtime) {
                    console.log(`[OutputReader] Switching to newer JSONL: ${fullPath}`);
                    watchedFile = fullPath;
                    lastPosition = 0;
                  }
                } catch { /* stat failed */ }
              }
            }
            readNewLines();
          });
        } catch {
          console.log(`[OutputReader] fs.watch failed, relying on polling only`);
        }

        // Also poll periodically — macOS fs.watch is unreliable
        pollTimer = setInterval(readNewLines, POLL_MS);
      } catch (err) {
        console.error(`[OutputReader] Error setting up watcher for ${agentId}:`, err);
      }
    };

    findAndWatch();

    return () => {
      stopped = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
  }

  /**
   * Extract readable output from a Claude JSONL entry.
   * Also drives status: "human" → working, "result" → idle.
   *
   * Claude JSONL types:
   * - { type: "human" }         → user sent message, agent starts working
   * - { type: "assistant", message: { content: [...] } } → agent responding
   * - { type: "result", result: "..." } → turn complete, waiting for input
   */
  private extractClaudeOutput(
    entry: Record<string, unknown>,
    emit: (text: string) => void,
    agentId: string,
  ): void {
    // User message → agent is now working
    if (entry.type === "user" || entry.type === "human") {
      this.onStatus?.(agentId, "working");
    }

    // Assistant messages — extract text blocks (skip thinking blocks)
    if (entry.type === "assistant") {
      const message = entry.message as Record<string, unknown> | undefined;
      // Accumulate token usage
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (usage) {
        const reader = this.readers.get(agentId);
        if (reader) {
          const inp = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
          const out = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
          if (inp > 0 || out > 0) {
            reader.inputTokens += inp;
            reader.outputTokens += out;
            this.onTokenUpdate?.(agentId, reader.inputTokens, reader.outputTokens);
          }
        }
      }
      const stopReason = message?.stop_reason ?? (entry as Record<string, unknown>).stop_reason;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content && Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            emit(block.text.slice(0, 200));
          }
        }
      }
      // end_turn means the assistant finished — set idle; otherwise working
      if (stopReason === "end_turn") {
        this.onStatus?.(agentId, "idle");
      } else {
        this.onStatus?.(agentId, "working");
      }
    }

    // Result → turn complete, agent is idle (waiting for user input)
    if (entry.type === "result") {
      const result = entry.result;
      if (typeof result === "string" && result.trim()) {
        emit(result.slice(0, 200));
      }
      this.onStatus?.(agentId, "idle");
    }
  }

  // ── lsof fallback reader ──────────────────────────────────────

  private startLsofReader(
    agentId: string,
    pid: number,
    onOutput: OutputCallback,
  ): () => void {
    const knownFiles = new Set<string>();
    let stopped = false;

    console.log(`[OutputReader] lsof reader for ${agentId}: pid=${pid}`);

    const poll = () => {
      if (stopped) return;
      execFile("lsof", ["-p", String(pid)], { timeout: 5000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        if (err || stopped) return;

        const lines = stdout.split("\n");
        const newFiles: string[] = [];

        for (const line of lines) {
          // lsof output columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          const cols = line.trim().split(/\s+/);
          if (cols.length < 9) continue;
          const name = cols.slice(8).join(" ");
          if (!name || name.startsWith("/dev/") || name.startsWith("/System/")) continue;

          const ext = path.extname(name);
          if (!SOURCE_EXTS.has(ext)) continue;
          if (!knownFiles.has(name)) {
            knownFiles.add(name);
            newFiles.push(name);
          }
        }

        if (newFiles.length > 0) {
          const basename = path.basename(newFiles[newFiles.length - 1]);
          onOutput(`Editing ${basename}`);
        }
      });
    };

    const timer = setInterval(poll, 5000);
    poll(); // Initial poll

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
