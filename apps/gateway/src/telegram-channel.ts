import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { nanoid } from "nanoid";
import { DEFAULT_AGENT_DEFS, type AgentDefinition } from "@office/shared";
import type { GatewayEvent, Command } from "@office/shared";
import type { Channel, CommandMeta } from "./transport.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let bot: TelegramBot | null = null;

/** TG message ID -> agentId (anchors + status messages) */
const replyToAgent = new Map<number, string>();

/** "chatId:agentId" -> anchor message ID */
const anchorMessages = new Map<string, number>();

/** "chatId:agentId" -> editable status message ID */
const statusMessages = new Map<string, number>();

/** All chat IDs that have interacted with the bot */
const activeChatIds = new Set<number>();

/** "chatId:userId" -> agentId sticky session (set by /alex, /eli, etc.) */
const stickyAgent = new Map<string, string>();

/** Allowed TG user IDs (empty = allow all) */
let allowedUsers: string[] = [];

/** Live hired agents — synced from gateway via setTelegramAgentDefs() */
let hiredAgents: AgentMenuItem[] = [];

/** All agent definitions (fallback for name/role/personality lookup) */
let allAgentDefs: AgentDefinition[] = [];

// ---------------------------------------------------------------------------
// Agent menu (only hired agents; falls back to all defs if none hired)
// ---------------------------------------------------------------------------

interface AgentMenuItem {
  id: string;
  name: string;
  role: string;
  personality: string;
}

function buildAgentMenu(): AgentMenuItem[] {
  return hiredAgents.length > 0 ? hiredAgents : allAgentDefs.map((d) => ({
    id: d.id,
    name: d.name,
    role: d.role,
    personality: d.personality,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** TG command -> agentId mapping (commands must be [a-z0-9_], 1-32 chars) */
const cmdToAgentId = new Map<string, string>();

/** Convert an agent ID or name to a valid TG bot command */
function toTgCommand(agent: AgentMenuItem): string {
  // If the id is already a simple lowercase word (e.g. "alex", "rex"), use it directly
  if (/^[a-z][a-z0-9_]{0,31}$/.test(agent.id)) return agent.id;
  // Otherwise derive from the display name: lowercase, replace non-alphanum with _
  const fromName = agent.name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (fromName.length > 0 && fromName.length <= 32) return fromName;
  // Last resort: "a" + first 8 chars of id lowercased
  return ("a" + agent.id.replace(/[^a-z0-9]/gi, "").toLowerCase()).slice(0, 32);
}

function tgMeta(): CommandMeta {
  return { role: "owner", clientId: "telegram" };
}

function resolveAgentFromReply(msg: TelegramBot.Message): string | null {
  const replyId = msg.reply_to_message?.message_id;
  if (!replyId) return null;
  return replyToAgent.get(replyId) ?? null;
}

function anchorKey(chatId: number, agentId: string): string {
  return `${chatId}:${agentId}`;
}

/** Keep maps from growing unbounded */
function evictIfNeeded<K, V>(map: Map<K, V>, limit = 2000) {
  if (map.size <= limit) return;
  const it = map.keys();
  for (let i = 0; i < map.size - limit; i++) {
    const k = it.next().value;
    if (k !== undefined) map.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Channel implementation
// ---------------------------------------------------------------------------

/**
 * Update the full agent definitions (used as fallback for name/role lookup).
 */
export function setTelegramAgentDefs(defs: AgentDefinition[]) {
  allAgentDefs = defs;
}

/**
 * Sync the currently hired agents to the Telegram channel.
 * Only these agents appear in the bot menu and can receive messages.
 * Also refreshes the bot menu commands if the bot is active.
 */
export function syncTelegramHiredAgents(agents: { agentId: string; name: string; role: string; personality?: string }[]) {
  hiredAgents = agents.map((a) => ({
    id: a.agentId,
    name: a.name,
    role: a.role,
    personality: a.personality ?? "",
  }));
  rebuildBotCommands();
}

/** Rebuild TG bot command menu from current agent list */
function rebuildBotCommands() {
  if (!bot) return;
  const menu = buildAgentMenu();
  // Build cmd→agentId mapping and deduplicate commands
  cmdToAgentId.clear();
  const seen = new Set<string>();
  const commands: { command: string; description: string }[] = [];
  for (const a of menu) {
    let cmd = toTgCommand(a);
    // Handle duplicates (e.g. multiple "Alex" agents) by appending a suffix
    if (seen.has(cmd)) {
      let i = 2;
      while (seen.has(`${cmd}${i}`)) i++;
      cmd = `${cmd}${i}`;
    }
    seen.add(cmd);
    cmdToAgentId.set(cmd, a.id);
    commands.push({ command: cmd, description: `${a.name} - ${a.role}`.slice(0, 256) });
  }
  commands.push({ command: "cancel", description: "Cancel current agent task" });
  commands.push({ command: "status", description: "Check agent statuses" });
  bot.setMyCommands(commands).catch((err: Error) => {
    console.error("[Telegram] Failed to update bot commands:", err.message);
  });
}

export const telegramChannel: Channel = {
  name: "Telegram",

  async init(commandHandler: (cmd: Command, meta: CommandMeta) => void): Promise<boolean> {
    const token = config.telegramBotToken;
    if (!token) return false;

    allowedUsers = config.telegramAllowedUsers ?? [];

    bot = new TelegramBot(token, { polling: true });

    bot.on("polling_error", (err: any) => {
      const code = err?.response?.statusCode ?? err?.code;
      if (code === 409) {
        console.warn("[Telegram] 409 Conflict: token already used by another instance. Stopping.");
        bot?.stopPolling();
        return;
      }
      console.error("[Telegram] Polling error:", err.message ?? err);
    });

    // Register bot menu commands (sanitized for TG command format)
    rebuildBotCommands();

    const botInfo = await bot.getMe();
    const agentMenu = buildAgentMenu();
    console.log(`[Telegram] @${botInfo.username} ready (single-bot mode, ${agentMenu.length} agents)`);

    // ----- Message handler -----
    bot.on("message", (msg) => {
      if (!msg.text || !msg.from) return;

      // Whitelist check
      if (allowedUsers.length > 0 && !allowedUsers.includes(String(msg.from.id))) return;

      activeChatIds.add(msg.chat.id);
      const text = msg.text.trim();

      // Build menu fresh each message so it picks up agent changes
      const currentMenu = buildAgentMenu();

      // --- /start ---
      if (text === "/start" || text === `/start@${botInfo.username}`) {
        // Show TG-safe commands mapped to agent names
        const lines: string[] = [];
        for (const [cmd, agentId] of cmdToAgentId) {
          const a = currentMenu.find((m) => m.id === agentId);
          if (a) lines.push(`/${cmd} - ${a.name} (${a.role})`);
        }
        bot!.sendMessage(
          msg.chat.id,
          `Welcome to Bit Office!\n\nAvailable agents:\n${lines.join("\n")}\n\nTap a command to start a conversation, then send messages directly.`,
        );
        return;
      }

      // --- Agent selection commands (resolved via cmdToAgentId map) ---
      const cmdMatch = text.match(/^\/([a-z0-9_]+)(?:@\S+)?$/);
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        const resolvedAgentId = cmdToAgentId.get(cmd);
        if (resolvedAgentId) {
          const agentDef = currentMenu.find((a) => a.id === resolvedAgentId);
          const displayName = agentDef?.name ?? resolvedAgentId;
          stickyAgent.set(`${msg.chat.id}:${msg.from!.id}`, resolvedAgentId);
          bot!.sendMessage(
            msg.chat.id,
            `Now talking to ${displayName}. Send messages directly — switch anytime with another agent command.`,
          ).then((sent) => {
            replyToAgent.set(sent.message_id, resolvedAgentId);
            anchorMessages.set(anchorKey(msg.chat.id, resolvedAgentId), sent.message_id);
            evictIfNeeded(replyToAgent);
          });
          return;
        }
      }

      // --- /yes, /no ---
      if (text === "/yes" || text === "/no") {
        commandHandler(
          { type: "APPROVAL_DECISION", approvalId: "__all__", decision: text.slice(1) as "yes" | "no" },
          tgMeta(),
        );
        return;
      }

      // --- /cancel ---
      if (text === "/cancel" || text === `/cancel@${botInfo.username}`) {
        const agentId = resolveAgentFromReply(msg);
        if (agentId) {
          commandHandler({ type: "CANCEL_TASK", agentId, taskId: "" }, tgMeta());
          bot!.sendMessage(msg.chat.id, `Cancelled ${agentId}'s current task`);
        } else {
          bot!.sendMessage(msg.chat.id, "Reply to an agent's message to cancel its task.");
        }
        return;
      }

      // --- /status ---
      if (text === "/status" || text === `/status@${botInfo.username}`) {
        commandHandler({ type: "PING" }, tgMeta());
        return;
      }

      // Ignore other commands
      if (text.startsWith("/")) return;

      // --- Reply-chain routing (reply > sticky > prompt) ---
      const agentId = resolveAgentFromReply(msg) ?? stickyAgent.get(`${msg.chat.id}:${msg.from!.id}`) ?? null;
      if (!agentId) {
        bot!.sendMessage(
          msg.chat.id,
          "Select an agent first: /alex, /eli, etc. After that, all messages go to that agent until you switch.",
        );
        return;
      }

      const def = currentMenu.find((a) => a.id === agentId);
      const taskId = nanoid();

      commandHandler(
        {
          type: "RUN_TASK",
          agentId,
          taskId,
          prompt: `📱 ${text}`,
          ...(def ? { name: def.name, role: def.role, personality: def.personality } : {}),
        },
        tgMeta(),
      );
    });

    return true;
  },

  broadcast(event: GatewayEvent) {
    if (!bot) return;

    const agentId = "agentId" in event ? (event as any).agentId as string : null;
    if (!agentId) return;

    const hasChain = [...replyToAgent.values()].includes(agentId);
    if (!hasChain) return;

    for (const chatId of activeChatIds) {
      const key = anchorKey(chatId, agentId);
      const anchor = anchorMessages.get(key);

      if (event.type === "TASK_STARTED") {
        bot.sendMessage(chatId, `Working on it...`, {
          ...(anchor ? { reply_to_message_id: anchor } : {}),
        }).then((sent) => {
          statusMessages.set(key, sent.message_id);
          replyToAgent.set(sent.message_id, agentId);
          evictIfNeeded(replyToAgent);
        }).catch((err: Error) => {
          console.error("[Telegram] Send failed:", err.message);
        });
      }

      if (event.type === "TASK_DONE") {
        const r = (event as any).result;
        const summary = (r?.summary ?? "Done").slice(0, 500);
        const files = r?.changedFiles?.length ? `\n\nFiles: ${r.changedFiles.length}` : "";
        const text = `Done: ${summary}${files}`;
        const msgId = statusMessages.get(key);

        if (msgId) {
          bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {
            bot!.sendMessage(chatId, text).catch(() => {});
          });
          statusMessages.delete(key);
        } else {
          bot.sendMessage(chatId, text).catch(() => {});
        }
      }

      if (event.type === "TASK_FAILED") {
        const errMsg = ((event as any).error ?? "Unknown error").slice(0, 300);
        const text = `Failed: ${errMsg}`;
        const msgId = statusMessages.get(key);

        if (msgId) {
          bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {
            bot!.sendMessage(chatId, text).catch(() => {});
          });
          statusMessages.delete(key);
        } else {
          bot.sendMessage(chatId, text).catch(() => {});
        }
      }

      if (event.type === "APPROVAL_NEEDED") {
        const e = event as any;
        bot.sendMessage(
          chatId,
          `Approval needed: ${e.title}\n${e.summary}\n\nReply /yes or /no`,
          { ...(anchor ? { reply_to_message_id: anchor } : {}) },
        ).then((sent) => {
          replyToAgent.set(sent.message_id, agentId);
        }).catch(() => {});
      }
    }
  },

  destroy() {
    bot?.stopPolling();
    bot = null;
    replyToAgent.clear();
    anchorMessages.clear();
    statusMessages.clear();
    activeChatIds.clear();
    cmdToAgentId.clear();
    stickyAgent.clear();
  },
};
