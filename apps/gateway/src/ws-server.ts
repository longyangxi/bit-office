import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { CommandSchema } from "@office/shared";
import type { GatewayEvent, Command, UserRole } from "@office/shared";
import { config } from "./config.js";
import { networkInterfaces, homedir } from "os";
import { readFile, stat } from "fs/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, extname, resolve } from "path";
import * as Ably from "ably";
import type { Channel, CommandMeta } from "./transport.js";
import { nanoid } from "nanoid";

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, { role: UserRole; clientId: string }>();
let pairCode: string | null = null;
let onCommand: ((cmd: Command, meta: CommandMeta) => void) | null = null;

// In-memory share token store: token → { role } (for public share links)
const shareTokens = new Map<string, { role: "collaborator" | "spectator" }>();

// Session tokens — persisted to disk so they survive gateway restarts
// Instance-scoped to prevent cross-instance auth token leakage
function getSessionTokensFile(): string { return resolve(config.instanceDir, "session-tokens.json"); }

function loadSessionTokens(): Map<string, UserRole> {
  try {
    const f = getSessionTokensFile();
    if (existsSync(f)) {
      const data = JSON.parse(readFileSync(f, "utf-8"));
      return new Map(Object.entries(data) as [string, UserRole][]);
    }
  } catch { /* corrupt file, start fresh */ }
  return new Map();
}

function persistSessionTokens() {
  const dir = resolve(config.instanceDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSessionTokensFile(), JSON.stringify(Object.fromEntries(sessionTokens)), "utf-8");
}

const sessionTokens = loadSessionTokens();

function addSessionToken(token: string, role: UserRole) {
  sessionTokens.set(token, role);
  persistSessionTokens();
}

// Pending WS connections awaiting AUTH
const pendingAuth = new Set<WebSocket>();
const AUTH_TIMEOUT_MS = 5000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".txt": "text/plain",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

export function setPairCode(code: string) {
  pairCode = code;
}

/** Send an event to a specific client by clientId (unicast) */
export function sendToClient(clientId: string, event: GatewayEvent) {
  const data = JSON.stringify(event);
  for (const [ws, info] of clients) {
    if (info.clientId === clientId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return;
    }
  }
}

export const wsChannel: Channel = {
  name: "WebSocket",

  async init(commandHandler: (cmd: Command, meta: CommandMeta) => void): Promise<boolean> {
    onCommand = commandHandler;

    return new Promise((resolve) => {
      const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Quick connect — skip pair code for local dev
        if (req.method === "GET" && req.url === "/connect") {
          if (config.ablyApiKey) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Quick connect disabled" }));
            return;
          }
          const sessionToken = nanoid();
          addSessionToken(sessionToken, "owner");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            machineId: config.machineId,
            wsUrl: `ws://localhost:${config.wsPort}`,
            role: "owner",
            sessionToken,
          }));
          return;
        }

        if (req.method === "POST" && req.url === "/pair/validate") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { code } = JSON.parse(body);
              if (!pairCode || code !== pairCode) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid pair code" }));
                return;
              }
              const sessionToken = nanoid();
              addSessionToken(sessionToken, "owner");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                machineId: config.machineId,
                wsUrl: `ws://localhost:${config.wsPort}`,
                hasAbly: !!config.ablyApiKey,
                role: "owner",
                sessionToken,
              }));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Bad request" }));
            }
          });
          return;
        }

        // Share link creation (owner-only)
        if (req.method === "POST" && req.url === "/share/create") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { code, role } = JSON.parse(body);
              if (!pairCode || code !== pairCode) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid pair code" }));
                return;
              }
              const shareRole = role === "collaborator" ? "collaborator" : "spectator";
              const token = nanoid();
              shareTokens.set(token, { role: shareRole });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ token, role: shareRole }));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Bad request" }));
            }
          });
          return;
        }

        // Share link validation (public users)
        if (req.method === "POST" && req.url === "/share/validate") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { token } = JSON.parse(body);
              const share = shareTokens.get(token);
              if (!share) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid share token" }));
                return;
              }
              const sessionToken = nanoid();
              addSessionToken(sessionToken, share.role);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                machineId: config.machineId,
                wsUrl: `ws://localhost:${config.wsPort}`,
                hasAbly: !!config.ablyApiKey,
                role: share.role,
                sessionToken,
              }));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Bad request" }));
            }
          });
          return;
        }

        // Ably token endpoint
        if (req.method === "POST" && req.url === "/ably/token") {
          if (!config.ablyApiKey) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Ably not configured" }));
            return;
          }

          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", async () => {
            try {
              let targetMachineId = config.machineId;
              let sessionToken: string | undefined;
              try {
                const parsed = JSON.parse(body);
                if (parsed.machineId) targetMachineId = parsed.machineId;
                if (parsed.sessionToken) sessionToken = parsed.sessionToken;
              } catch {
                // no body
              }

              // Require valid sessionToken — derive role from server, never from client
              if (!sessionToken) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Session token required" }));
                return;
              }
              const clientRole = sessionTokens.get(sessionToken);
              if (!clientRole) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid session token" }));
                return;
              }

              if (!targetMachineId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "No machine ID" }));
                return;
              }

              // Spectators get subscribe-only (no publish on commands channel)
              const commandsCap: Ably.capabilityOp[] = clientRole === "spectator" ? ["subscribe"] : ["publish"];
              const rest = new Ably.Rest({ key: config.ablyApiKey });
              const tokenRequest = await rest.auth.createTokenRequest({
                clientId: `${clientRole}:${nanoid(8)}`,
                ttl: 5 * 60 * 1000,
                capability: {
                  [`machine:${targetMachineId}:commands`]: commandsCap,
                  [`machine:${targetMachineId}:events`]: ["subscribe"],
                },
              });

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(tokenRequest));
            } catch (err) {
              console.error("[WS] Ably token error:", err);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Token creation failed" }));
            }
          });
          return;
        }

        // --- Reverse proxy for preview servers (enables tunnel access via single port) ---
        const url = req.url ?? "/";
        const proxyMatch = url.match(/^\/(preview-static|preview-app)(\/.*)?$/);
        if (proxyMatch) {
          const targetPort = proxyMatch[1] === "preview-static" ? 9199 : 9198;
          const targetPath = proxyMatch[2] || "/";
          const proxyReq = httpRequest(
            { hostname: "127.0.0.1", port: targetPort, path: targetPath, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
              proxyRes.pipe(res, { end: true });
            },
          );
          proxyReq.on("error", () => {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Preview server not running");
          });
          req.pipe(proxyReq, { end: true });
          return;
        }

        // --- Static file serving (fallback, production only) ---
        if (process.env.NODE_ENV === "development") {
          // In dev mode, redirect page requests to the Next.js dev server
          const url = req.url?.split("?")[0] ?? "/";
          const isPageRoute = url === "/" || url === "/pair" || url === "/office" || url === "/join" || !url.includes(".");
          if (isPageRoute) {
            const nextPort = process.env.NEXT_DEV_PORT ?? "3000";
            const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
            res.writeHead(302, { Location: `http://localhost:${nextPort}${url}${query}` });
            res.end();
            return;
          }
          res.writeHead(404);
          res.end("Not Found (dev mode — use Next.js dev server)");
          return;
        }
        await serveStatic(req, res);
      };

      const maxRetries = 10;
      let port = config.wsPort;

      const tryListen = () => {
        const httpServer = createServer(requestHandler);
        httpServer.listen(port, () => {
          config.wsPort = port;

          // Attach WebSocket server only after successful listen
          wss = new WebSocketServer({ server: httpServer });
          wss.on("connection", (ws) => {
            pendingAuth.add(ws);
            console.log(`[WS] Client connected, awaiting AUTH...`);

            // Disconnect if no AUTH within timeout
            const authTimer = setTimeout(() => {
              if (pendingAuth.has(ws)) {
                console.log(`[WS] AUTH timeout, disconnecting client`);
                pendingAuth.delete(ws);
                ws.close();
              }
            }, AUTH_TIMEOUT_MS);

            ws.on("message", (data) => {
              try {
                const msg = JSON.parse(data.toString());

                // Handle AUTH handshake
                if (pendingAuth.has(ws)) {
                  if (msg.type === "AUTH") {
                    if (msg.sessionToken) {
                      const role = sessionTokens.get(msg.sessionToken);
                      if (role) {
                        const clientId = nanoid(8);
                        clients.set(ws, { role, clientId });
                        pendingAuth.delete(ws);
                        clearTimeout(authTimer);
                        console.log(`[WS] Client authenticated as ${role} (total: ${clients.size})`);
                        return;
                      }
                    }
                    // AUTH with invalid/missing token — tell client and disconnect
                    console.log(`[WS] Invalid AUTH token, rejecting`);
                    ws.send(JSON.stringify({ type: "AUTH_FAILED" }));
                    pendingAuth.delete(ws);
                    clearTimeout(authTimer);
                    ws.close();
                    return;
                  }

                  // No AUTH message — reject unauthenticated client
                  console.log(`[WS] Non-AUTH message from unauthenticated client, rejecting`);
                  ws.send(JSON.stringify({ type: "AUTH_FAILED" }));
                  pendingAuth.delete(ws);
                  clearTimeout(authTimer);
                  ws.close();
                  return;
                }

                const clientInfo = clients.get(ws);
                if (!clientInfo) return; // not authenticated
                const parsed = CommandSchema.parse(msg);
                onCommand?.(parsed, { role: clientInfo.role, clientId: clientInfo.clientId });
              } catch (err) {
                console.error("[WS] Invalid command:", err);
              }
            });

            ws.on("close", () => {
              pendingAuth.delete(ws);
              clients.delete(ws);
              clearTimeout(authTimer);
              console.log(`[WS] Client disconnected (total: ${clients.size})`);
            });
          });

          console.log(`[WS] Server listening on port ${port}`);
          printLanAddresses();
          resolve(true);
        });

        httpServer.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && port - config.wsPort < maxRetries) {
            const oldPort = port;
            port++;
            console.log(`[WS] Port ${oldPort} in use, trying ${port}...`);
            tryListen();
          } else {
            console.error(`[WS] Failed to start server:`, err.message);
            resolve(false);
          }
        });
      };

      tryListen();
    });
  },

  broadcast(event: GatewayEvent) {
    const data = JSON.stringify(event);
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  },

  destroy() {
    for (const [ws] of clients) {
      ws.close();
    }
    clients.clear();
    wss?.close();
    wss = null;
  },
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = decodeURIComponent(req.url?.split("?")[0] ?? "/");

  const routeMap: Record<string, string> = {
    "/": "/index.html",
    "/pair": "/pair.html",
    "/office": "/office.html",
    "/join": "/join.html",
  };

  let filePath: string;
  if (routeMap[url]) {
    filePath = join(config.webDir, routeMap[url]);
  } else {
    filePath = join(config.webDir, url);
  }

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    try {
      const htmlPath = filePath + ".html";
      const content = await readFile(htmlPath);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }
}

function printLanAddresses() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`[WS] LAN: http://${net.address}:${config.wsPort}`);
      }
    }
  }
}
