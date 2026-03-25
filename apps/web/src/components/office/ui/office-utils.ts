import React from "react";
import { sendCommand } from "@/lib/connection";
import { getGatewayHttpUrl } from "@/lib/storage";
import { TERM_TEXT } from "./termTheme";

// Check if Enter key is a real submit (not IME confirmation, not Shift/Ctrl+Enter newline)
// Chrome: isComposing=true during IME; WKWebView (Tauri): keyCode=229 during IME
export function isRealEnter(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

// Match URLs and absolute file paths — simple, non-greedy patterns
export const URL_RE = /https?:\/\/[^\s)>\]]+/g;
export const FILE_RE = /(?:^|\s)(\/[\w./-]+\.\w+)/g;

export function linkifyText(children: React.ReactNode): React.ReactNode {
  if (typeof children !== "string") {
    if (Array.isArray(children)) {
      return children.map((child, i) => typeof child === "string" ? linkifyText(child) : child);
    }
    return children;
  }
  const text = children;
  // Find all URLs
  const links: { start: number; end: number; url: string; type: "url" | "file" }[] = [];
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    links.push({ start: m.index, end: m.index + m[0].length, url: m[0], type: "url" });
  }
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text)) !== null) {
    const filePath = m[1];
    const fileStart = m.index + m[0].indexOf(filePath);
    // Don't overlap with existing URL matches
    if (!links.some(l => fileStart >= l.start && fileStart < l.end)) {
      links.push({ start: fileStart, end: fileStart + filePath.length, url: filePath, type: "file" });
    }
  }
  if (links.length === 0) return text;
  links.sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const link of links) {
    if (link.start > lastIdx) parts.push(text.slice(lastIdx, link.start));
    if (link.type === "url") {
      parts.push(React.createElement("a", { key: link.start, href: link.url, target: "_blank", rel: "noopener noreferrer", style: { color: TERM_TEXT } }, link.url));
    } else {
      parts.push(React.createElement("span", { key: link.start, onClick: () => sendCommand({ type: "OPEN_FILE", path: link.url }), style: { color: TERM_TEXT, cursor: "pointer" }, title: "Click to open" }, link.url));
    }
    lastIdx = link.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/**
 * Get the gateway base URL for preview routes.
 * All preview URLs go through the gateway's HTTP server:
 *   /preview-static/* — built-in static file serving (no child process)
 *   /preview-app/*    — reverse proxy to command-mode server
 */
function getPreviewBase(): string {
  if (typeof window === "undefined") return "";
  return getGatewayHttpUrl().replace(/\/$/, "");
}

/**
 * Rewrite legacy localhost preview URLs to gateway-relative paths.
 * Handles URLs from agents that still report localhost:9198.
 */
export function tunnelRewrite(url: string): string {
  if (typeof window === "undefined") return url;
  const base = getPreviewBase();
  // App/command preview (port 9198) → gateway proxy
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1):9198(?:\/|$|\?|#)/.test(url))
    return url.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):9198/, `${base}/preview-app`);
  // Legacy static preview URLs (port 9199) → gateway built-in serving
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1):9199(?:\/|$|\?|#)/.test(url))
    return url.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):9199/, `${base}/preview-static`);
  return url;
}

/** Compute expected preview URL from result metadata (no server started yet) */
export function computePreviewUrl(result: { previewUrl?: string; previewCmd?: string; previewPort?: number; previewPath?: string; entryFile?: string }): string | undefined {
  const base = getPreviewBase();
  if (result.previewUrl) return tunnelRewrite(result.previewUrl);
  if (result.previewCmd && result.previewPort) return `${base}/preview-app`;
  if (result.previewPath) return `${base}/preview-static/${result.previewPath.split("/").pop()}`;
  if (result.entryFile && /\.html?$/i.test(result.entryFile)) return `${base}/preview-static/${result.entryFile.split("/").pop()}`;
  return undefined;
}

/** Whether result has a web-previewable output */
export function hasWebPreview(result: { previewUrl?: string; previewCmd?: string; previewPort?: number; previewPath?: string; entryFile?: string }): boolean {
  return !!(result.previewUrl || (result.previewCmd && result.previewPort) || result.previewPath || (result.entryFile && /\.html?$/i.test(result.entryFile)));
}

/** Strip markdown formatting from preview fields */
export function cleanPreviewField(v?: string): string | undefined {
  if (!v) return undefined;
  const cleaned = v.replace(/\*\*/g, "").replace(/`/g, "").replace(/^_+|_+$/g, "").trim();
  return cleaned || undefined;
}

/** Build a SERVE_PREVIEW command from result fields */
export function buildPreviewCommand(result: { previewPath?: string; previewCmd?: string; previewPort?: number; projectDir?: string; entryFile?: string }) {
  const cmd = cleanPreviewField(result.previewCmd);
  const entry = cleanPreviewField(result.entryFile);
  const previewPath = cleanPreviewField(result.previewPath);
  if (cmd && result.previewPort) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: cmd, previewPort: result.previewPort, cwd: result.projectDir };
  }
  if (previewPath) {
    return { type: "SERVE_PREVIEW" as const, filePath: previewPath };
  }
  // HTML entryFile with projectDir — serve the file statically
  if (entry && /\.html?$/i.test(entry) && result.projectDir) {
    return { type: "SERVE_PREVIEW" as const, filePath: result.projectDir + "/" + entry };
  }
  // Desktop/CLI app: PREVIEW_CMD without port, or non-HTML entry file
  if (cmd) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: cmd, cwd: result.projectDir };
  }
  if (entry && !/\.html?$/i.test(entry)) {
    return { type: "SERVE_PREVIEW" as const, previewCmd: entry, cwd: result.projectDir };
  }
  return null;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

const DONE_VERBS = ["Brewed", "Crafted", "Forged", "Compiled", "Shipped", "Deployed", "Hacked", "Rendered", "Built", "Cooked"];
export function formatDuration(ms: number): string {
  const verb = DONE_VERBS[Math.floor(ms / 1000) % DONE_VERBS.length];
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${verb} in ${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${verb} for ${min}m ${remSec}s`;
}

// ---------------------------------------------------------------------------
// Random short agent name generator
// ---------------------------------------------------------------------------
const _SHORT_NAMES = ["Alex","Sam","Max","Leo","Mia","Kai","Zoe","Eli","Ava","Jay","Rio","Ash","Sky","Kit","Noa","Rex","Ivy","Ace","Ren","Jax","Finn","Luna","Cleo","Sage","Wren","Iris","Otto","Hugo","Theo","Lux","Pip","Dot","Val","Mae","Emi","Yuki","Sora","Riku","Nami","Hana"];
export function generateRandomName(): string {
  return _SHORT_NAMES[Math.floor(Math.random() * _SHORT_NAMES.length)];
}
