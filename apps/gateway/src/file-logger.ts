/**
 * File logger — tees console.log/warn/error to a rotating log file.
 * Usage: call `installFileLogger(dir)` once at startup.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from "fs";
import { resolve } from "path";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const LOG_NAME = "gateway.log";
const BACKUP_NAME = "gateway.log.1";

let stream: WriteStream | null = null;
let logPath = "";
let backupPath = "";
let bytesWritten = 0;

function rotate() {
  if (!stream) return;
  stream.end();
  try { renameSync(logPath, backupPath); } catch { /* overwrite is fine */ }
  stream = createWriteStream(logPath, { flags: "a" });
  bytesWritten = 0;
}

function writeLine(level: string, args: unknown[]) {
  if (!stream) return;
  const ts = new Date().toISOString();
  const msg = args.map(a =>
    typeof a === "string" ? a : (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))
  ).join(" ");
  const line = `${ts} [${level}] ${msg}\n`;
  stream.write(line);
  bytesWritten += Buffer.byteLength(line);
  if (bytesWritten > MAX_SIZE) rotate();
}

/**
 * Install file logger: patches console.log/warn/error to also write to
 * `<dir>/gateway.log` with 5MB rotation (keeps 1 backup).
 */
export function installFileLogger(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  logPath = resolve(dir, LOG_NAME);
  backupPath = resolve(dir, BACKUP_NAME);

  // Resume byte count if log already exists
  try { bytesWritten = statSync(logPath).size; } catch { bytesWritten = 0; }

  stream = createWriteStream(logPath, { flags: "a" });

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => { origLog(...args); writeLine("INFO", args); };
  console.warn = (...args: unknown[]) => { origWarn(...args); writeLine("WARN", args); };
  console.error = (...args: unknown[]) => { origError(...args); writeLine("ERROR", args); };
}
