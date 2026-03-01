import { registerChannel, initTransports, publishEvent, destroyTransports } from "./transport.js";
import { wsChannel, setPairCode } from "./ws-server.js";
import { ablyChannel } from "./ably-client.js";
import { telegramChannel } from "./telegram-channel.js";
import { config, hasSetupRun, reloadConfig, saveConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { detectBackends, getBackend, getAllBackends } from "./backends.js";
import { createOrchestrator, previewServer, type Orchestrator, type OrchestratorEvent } from "@bit-office/orchestrator";
import type { Command, GatewayEvent } from "@office/shared";
import { AGENT_PRESETS } from "@office/shared";
import { nanoid } from "nanoid";
import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { ProcessScanner } from "./process-scanner.js";
import { ExternalOutputReader } from "./external-output-reader.js";

// Register all channels — each one self-activates if configured
registerChannel(wsChannel);
registerChannel(ablyChannel);
registerChannel(telegramChannel);

let orc: Orchestrator;
let scanner: ProcessScanner | null = null;
let outputReader: ExternalOutputReader | null = null;

/** Track external agents so PING can broadcast them */
const externalAgents = new Map<string, { agentId: string; name: string; backendId: string; pid: number; cwd: string | null; startedAt: number; status: "working" | "idle" }>();

function generatePairCode(): string {
  return nanoid(6).toUpperCase();
}

function showPairCode() {
  const code = generatePairCode();
  setPairCode(code);
  console.log("");
  console.log("╔══════════════════════════════════╗");
  console.log("║     PAIR CODE: " + code + "           ║");
  console.log("╚══════════════════════════════════╝");
  console.log("");
  console.log(`Open your phone → enter gateway address + code`);
  console.log("");
}

// ---------------------------------------------------------------------------
// Map orchestrator events → GatewayEvent (wire protocol)
// ---------------------------------------------------------------------------

function mapOrchestratorEvent(e: OrchestratorEvent): GatewayEvent | null {
  switch (e.type) {
    case "task:started":
      return { type: "TASK_STARTED", agentId: e.agentId, taskId: e.taskId, prompt: e.prompt };
    case "task:done":
      return { type: "TASK_DONE", agentId: e.agentId, taskId: e.taskId, result: e.result, isFinalResult: e.isFinalResult };
    case "task:failed":
      return { type: "TASK_FAILED", agentId: e.agentId, taskId: e.taskId, error: e.error };
    case "task:delegated":
      return { type: "TASK_DELEGATED", fromAgentId: e.fromAgentId, toAgentId: e.toAgentId, taskId: e.taskId, prompt: e.prompt };
    case "agent:status":
      return { type: "AGENT_STATUS", agentId: e.agentId, status: e.status };
    case "approval:needed":
      return { type: "APPROVAL_NEEDED", approvalId: e.approvalId, agentId: e.agentId, taskId: e.taskId, title: e.title, summary: e.summary, riskLevel: e.riskLevel };
    case "log:append":
      return { type: "LOG_APPEND", agentId: e.agentId, taskId: e.taskId, stream: e.stream, chunk: e.chunk };
    case "team:chat":
      return { type: "TEAM_CHAT", fromAgentId: e.fromAgentId, toAgentId: e.toAgentId, message: e.message, messageType: e.messageType, taskId: e.taskId, timestamp: e.timestamp };
    case "task:queued":
      return { type: "TASK_QUEUED", agentId: e.agentId, taskId: e.taskId, prompt: e.prompt, position: e.position };
    case "agent:created":
      return { type: "AGENT_CREATED", agentId: e.agentId, name: e.name, role: e.role, palette: e.palette, personality: e.personality, backend: e.backend, isTeamLead: e.isTeamLead, teamId: e.teamId };
    case "agent:fired":
      return { type: "AGENT_FIRED", agentId: e.agentId };
    case "task:result-returned":
      return { type: "TASK_RESULT_RETURNED", fromAgentId: e.fromAgentId, toAgentId: e.toAgentId, taskId: e.taskId, summary: e.summary, success: e.success };
    // New events (worktree, retry) — log only, no wire protocol equivalent yet
    case "task:retrying":
      console.log(`[Retry] Agent ${e.agentId} retrying task ${e.taskId} (attempt ${e.attempt}/${e.maxRetries})`);
      return null;
    case "worktree:created":
      console.log(`[Worktree] Created ${e.worktreePath} for agent ${e.agentId}`);
      return null;
    case "worktree:merged":
      console.log(`[Worktree] Merged branch ${e.branch} for agent ${e.agentId} (success=${e.success})`);
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Command handler — maps incoming commands → orchestrator method calls
// ---------------------------------------------------------------------------

function handleCommand(parsed: Command) {
  console.log("[Gateway] Received command:", parsed.type, JSON.stringify(parsed));

  switch (parsed.type) {
    case "CREATE_AGENT": {
      const backendId = parsed.backend ?? config.defaultBackend;
      console.log(`[Gateway] Creating agent: ${parsed.agentId} (${parsed.name} - ${parsed.role}) backend=${backendId}`);
      orc.createAgent({
        agentId: parsed.agentId,
        name: parsed.name,
        role: parsed.role,
        personality: parsed.personality,
        backend: backendId,
        palette: parsed.palette,
      });
      break;
    }
    case "FIRE_AGENT": {
      console.log(`[Gateway] Firing agent: ${parsed.agentId}`);
      const agentToFire = orc.getAgent(parsed.agentId);
      if (agentToFire?.pid) scanner?.addGracePid(agentToFire.pid);
      orc.removeAgent(parsed.agentId);
      break;
    }
    case "RUN_TASK": {
      let agent = orc.getAgent(parsed.agentId);
      if (!agent && parsed.name) {
        const backendId = parsed.backend ?? config.defaultBackend;
        console.log(`[Gateway] Auto-creating agent for RUN_TASK: ${parsed.agentId} backend=${backendId}`);
        orc.createAgent({
          agentId: parsed.agentId,
          name: parsed.name,
          role: parsed.role ?? "",
          personality: parsed.personality,
          backend: backendId,
          resumeHistory: true,
        });
        agent = orc.getAgent(parsed.agentId);
      }
      if (agent) {
        console.log(`[Gateway] RUN_TASK: agent=${parsed.agentId}, isLead=${orc.isTeamLead(parsed.agentId)}, hasTeam=${orc.getAllAgents().length > 1}`);
        orc.runTask(parsed.agentId, parsed.taskId, parsed.prompt, { repoPath: parsed.repoPath });
      } else {
        publishEvent({
          type: "TASK_FAILED",
          agentId: parsed.agentId,
          taskId: parsed.taskId,
          error: "Agent not found. Create it first.",
        });
      }
      break;
    }
    case "APPROVAL_DECISION": {
      orc.resolveApproval(parsed.approvalId, parsed.decision);
      break;
    }
    case "CANCEL_TASK": {
      orc.cancelTask(parsed.agentId);
      break;
    }
    case "SERVE_PREVIEW": {
      const filePath = parsed.filePath;
      console.log(`[Gateway] SERVE_PREVIEW: ${filePath}`);
      previewServer.serve(filePath);
      break;
    }
    case "OPEN_FILE": {
      const raw = parsed.path;
      const resolved = path.resolve(config.defaultWorkspace, raw);
      const normalized = path.normalize(resolved);

      if (!normalized.startsWith(config.defaultWorkspace + path.sep) && normalized !== config.defaultWorkspace) {
        console.error(`[Gateway] Blocked OPEN_FILE: path "${raw}" resolves outside workspace`);
        break;
      }
      if (!existsSync(normalized)) {
        console.error(`[Gateway] OPEN_FILE: path does not exist: ${normalized}`);
        break;
      }

      console.log(`[Gateway] Opening file: ${normalized}`);
      execFile("open", [normalized], (err) => {
        if (err) console.error(`[Gateway] Failed to open file: ${err.message}`);
      });
      break;
    }
    case "CREATE_TEAM": {
      const { leadPresetIndex, memberPresetIndices, backends } = parsed;
      const allIndices = [leadPresetIndex, ...memberPresetIndices.filter(i => i !== leadPresetIndex)];
      console.log(`[Gateway] Creating team: lead=${leadPresetIndex}, members=${memberPresetIndices.join(",")}`);
      let leadAgentId: string | null = null;
      const teamId = `team-${nanoid(6)}`;

      for (const idx of allIndices) {
        const preset = AGENT_PRESETS[idx];
        if (!preset) continue;
        const agentId = `agent-${nanoid(6)}`;
        const backendId = backends?.[String(idx)] ?? config.defaultBackend;

        if (idx === leadPresetIndex) {
          leadAgentId = agentId;
          orc.setTeamLead(agentId);
        }

        orc.createAgent({
          agentId,
          name: preset.name,
          role: preset.role,
          personality: preset.personality,
          backend: backendId,
          palette: preset.palette,
          teamId,
        });
      }

      if (leadAgentId) {
        const leadPreset = AGENT_PRESETS[leadPresetIndex];
        publishEvent({
          type: "TEAM_CHAT",
          fromAgentId: leadAgentId,
          message: `Team created! ${leadPreset?.name ?? "Lead"} is the Team Lead with ${memberPresetIndices.length} team members.`,
          messageType: "status",
          timestamp: Date.now(),
        });
      }
      break;
    }
    case "STOP_TEAM": {
      console.log("[Gateway] Stopping team work");
      orc.stopTeam();
      break;
    }
    case "FIRE_TEAM": {
      console.log("[Gateway] Firing entire team");
      // Record managed PIDs before they're killed — prevents scanner from picking them up as external
      for (const agent of orc.getAllAgents()) {
        const pid = agent.pid;
        if (pid) scanner?.addGracePid(pid);
      }
      orc.fireTeam();
      break;
    }
    case "KILL_EXTERNAL": {
      const ext = externalAgents.get(parsed.agentId);
      if (ext) {
        console.log(`[Gateway] Killing external process: ${ext.name} (pid=${ext.pid})`);
        scanner?.addGracePid(ext.pid);
        try {
          // Only kill the specific PID — do NOT use -pid (process group kill)
          // because external processes are not spawned by us with detached: true,
          // so their pgid may be the user's terminal — killing the group would
          // kill the entire terminal session.
          process.kill(ext.pid, "SIGKILL");
        } catch (err) {
          console.error(`[Gateway] Failed to kill pid ${ext.pid}:`, err);
        }
        // Clean up immediately — scanner will also detect removal next cycle
        outputReader?.detach(ext.agentId);
        externalAgents.delete(ext.agentId);
        publishEvent({ type: "AGENT_FIRED", agentId: ext.agentId });
      } else {
        console.log(`[Gateway] KILL_EXTERNAL: agent ${parsed.agentId} not found`);
      }
      break;
    }
    case "PING": {
      console.log("[Gateway] Received PING, broadcasting agent statuses");
      for (const agent of orc.getAllAgents()) {
        publishEvent({
          type: "AGENT_CREATED",
          agentId: agent.agentId,
          name: agent.name,
          role: agent.role,
          palette: agent.palette,
          personality: undefined,
          backend: agent.backend,
          isTeamLead: agent.isTeamLead,
          teamId: agent.teamId,
        });
        publishEvent({
          type: "AGENT_STATUS",
          agentId: agent.agentId,
          status: agent.status,
        });
      }
      // Also broadcast external agents
      for (const [, ext] of externalAgents) {
        publishEvent({
          type: "AGENT_CREATED",
          agentId: ext.agentId,
          name: ext.name,
          role: ext.cwd ? ext.cwd.split("/").pop() ?? ext.backendId : ext.backendId,
          isExternal: true,
          pid: ext.pid,
          cwd: ext.cwd ?? undefined,
          startedAt: ext.startedAt,
          backend: ext.backendId,
        });
        publishEvent({
          type: "AGENT_STATUS",
          agentId: ext.agentId,
          status: ext.status,
        });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // First run or --setup flag: interactive setup wizard
  if (!hasSetupRun() || process.argv.includes("--setup")) {
    await runSetup();
    reloadConfig();
  }

  // Auto-detect AI backends if not already detected
  if (config.detectedBackends.length === 0) {
    const detected = detectBackends();
    if (detected.length > 0) {
      config.detectedBackends = detected;
      if (!config.defaultBackend || !detected.includes(config.defaultBackend)) {
        config.defaultBackend = detected[0];
      }
      saveConfig({ detectedBackends: detected, defaultBackend: config.defaultBackend });
    }
  }

  // Register all known backends so any can be selected from the UI.
  // Detection only determines the default; uninstalled ones will fail at spawn time with a clear error.
  const backendsToUse = getAllBackends();

  orc = createOrchestrator({
    workspace: config.defaultWorkspace,
    backends: backendsToUse,
    defaultBackend: config.defaultBackend,
    worktree: false, // disabled by default for now
    retry: { maxRetries: 2, escalateToLeader: true },
    promptsDir: path.join(os.homedir(), ".bit-office", "prompts"),
    sandboxMode: config.sandboxMode,
  });

  // Forward orchestrator events to transport channels
  const forwardEvent = (event: OrchestratorEvent) => {
    const mapped = mapOrchestratorEvent(event);
    if (mapped) publishEvent(mapped);
  };

  orc.on("task:started", forwardEvent);
  orc.on("task:done", forwardEvent);
  orc.on("task:failed", forwardEvent);
  orc.on("task:delegated", forwardEvent);
  orc.on("task:retrying", forwardEvent);
  orc.on("agent:status", forwardEvent);
  orc.on("approval:needed", forwardEvent);
  orc.on("log:append", forwardEvent);
  orc.on("team:chat", forwardEvent);
  orc.on("task:queued", forwardEvent);
  orc.on("worktree:created", forwardEvent);
  orc.on("worktree:merged", forwardEvent);
  orc.on("agent:created", forwardEvent);
  orc.on("agent:fired", forwardEvent);
  orc.on("task:result-returned", forwardEvent);

  // Start external output reader
  outputReader = new ExternalOutputReader();

  // Start process scanner to detect external CLI agents
  scanner = new ProcessScanner(
    () => orc.getManagedPids(),
    {
      onAdded: (agents) => {
        for (const agent of agents) {
          const name = agent.command.charAt(0).toUpperCase() + agent.command.slice(1);
          const displayName = `${name} (${agent.pid})`;
          externalAgents.set(agent.agentId, {
            agentId: agent.agentId,
            name: displayName,
            backendId: agent.backendId,
            pid: agent.pid,
            cwd: agent.cwd,
            startedAt: agent.startedAt,
            status: agent.status,
          });
          console.log(`[ProcessScanner] External agent found: ${displayName} (pid=${agent.pid}, cwd=${agent.cwd})`);
          publishEvent({
            type: "AGENT_CREATED",
            agentId: agent.agentId,
            name: displayName,
            role: agent.cwd ? agent.cwd.split("/").pop() ?? agent.backendId : agent.backendId,
            isExternal: true,
            pid: agent.pid,
            cwd: agent.cwd ?? undefined,
            startedAt: agent.startedAt,
            backend: agent.backendId,
          });
          publishEvent({
            type: "AGENT_STATUS",
            agentId: agent.agentId,
            status: agent.status,
          });

          // Attach output reader for this external agent
          outputReader?.attach(agent.agentId, agent.pid, agent.cwd, agent.backendId, (chunk) => {
            publishEvent({
              type: "LOG_APPEND",
              agentId: agent.agentId,
              taskId: "external",
              stream: "stdout",
              chunk,
            });
          });
        }
      },
      onRemoved: (agentIds) => {
        for (const agentId of agentIds) {
          const ext = externalAgents.get(agentId);
          console.log(`[ProcessScanner] External agent gone: ${ext?.name ?? agentId}`);
          outputReader?.detach(agentId);
          externalAgents.delete(agentId);
          publishEvent({
            type: "AGENT_FIRED",
            agentId,
          });
        }
      },
      onChanged: (agents) => {
        for (const agent of agents) {
          const ext = externalAgents.get(agent.agentId);
          if (ext) {
            ext.status = agent.status;
          }
          publishEvent({
            type: "AGENT_STATUS",
            agentId: agent.agentId,
            status: agent.status,
          });
        }
      },
    },
  );
  scanner.start();

  const backendNames = config.detectedBackends.map((id) => getBackend(id)?.name ?? id).join(", ");
  console.log(`[Gateway] AI backends: ${backendNames || "none detected"} (default: ${getBackend(config.defaultBackend)?.name ?? config.defaultBackend})`);
  console.log(`[Gateway] Permissions: ${config.sandboxMode === "full" ? "Full access" : "Sandbox"}`);
  console.log(`[Gateway] Starting for machine: ${config.machineId}`);

  // Generate and display pair code
  showPairCode();

  // Start transports (WS + optional Ably)
  await initTransports(handleCommand);

  console.log("[Gateway] Listening for commands...");
  console.log("[Gateway] Press 'p' + Enter to generate a new pair code");

  // Auto-open browser only in production mode (pnpm start, not dev)
  if (process.env.NODE_ENV !== "development" && existsSync(config.webDir)) {
    const url = `http://localhost:${config.wsPort}`;
    console.log(`[Gateway] Opening ${url}`);
    execFile("open", [url]);
  }

  // Listen for stdin commands
  if (process.stdin.isTTY) {
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (data: string) => {
      const cmd = data.trim().toLowerCase();
      if (cmd === "p") {
        showPairCode();
      }
    });
  }
}

function cleanup() {
  console.log("[Gateway] Shutting down...");
  outputReader?.detachAll();
  scanner?.stop();
  previewServer.stop();
  orc?.destroy();
  destroyTransports();
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("SIGHUP", cleanup);

main().catch(console.error);
