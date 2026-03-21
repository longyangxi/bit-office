import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { nanoid } from "nanoid";
import { DEFAULT_AGENT_DEFS } from "@office/shared";
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

/** Allowed TG user IDs (empty = allow all) */
let allowedUsers: string[] = [];

// ---------------------------------------------------------------------------
// Agent menu (built from shared defs)
// ---------------------------------------------------------------------------

interface AgentMenuItem {
  id: string;
  name: string;
  role: string;
  personality: string;
}

function buildAgentMenu(): AgentMenuItem[] {
  return DEFAULT_AGENT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    role: d.role,
    personality: d.personality,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export const telegramChannel: Channel = {
  name: "Telegram",

  async init(commandHandler: (cmd: Command, meta: CommandMeta) => void): Promise<boolean> {
    const token = config.telegramBotToken;
    if (!token) return false;

    allowedUsers = config.telegramAllowedUsers ?? [];
    const agentMenu = buildAgentMenu();

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

    // Register bot menu commands
    await bot.setMyCommands([
      ...agentMenu.map((a) => ({
        command: a.id,
        description: `${a.name} - ${a.role}`,
      })),
      { command: "cancel", description: "Cancel current agent task" },
      { command: "status", description: "Check agent statuses" },
    ]);

    const botInfo = await bot.getMe();
    console.log(`[Telegram] @${botInfo.username} ready (single-bot mode, ${agentMenu.length} agents)`);

    // ----- Message handler -----
    bot.on("message", (msg) => {
      if (!msg.text || !msg.from) return;

      // Whitelist check
      if (allowedUsers.length > 0 && !allowedUsers.includes(String(msg.from.id))) return;

      activeChatIds.add(msg.chat.id);
      const text = msg.text.trim();

      // --- /start ---
      if (text === "/start" || text === `/start@${botInfo.username}`) {
        const lines = agentMenu.map((a) => `/${a.id} - ${a.name} (${a.role})`);
        bot!.sendMessage(
          msg.chat.id,
          `Welcome to Bit Office!\n\nAvailable agents:\n${lines.join("\n")}\n\nTap a command to start a conversation, then reply to the agent's message.`,
        );
        return;
      }

      // --- Agent selection commands: /alex, /mia, etc. ---
      const agentCmd = agentMenu.find((a) => text === `/${a.id}` || text === `/${a.id}@${botInfo.username}`);
      if (agentCmd) {
        const label = `${agentCmd.name} (${agentCmd.role})`;
        bot!.sendMessage(
          msg.chat.id,
          `${label}\n\nReply to this message to chat with ${agentCmd.name}`,
          { reply_markup: { force_reply: true, selective: true } },
        ).then((sent) => {
          replyToAgent.set(sent.message_id, agentCmd.id);
          anchorMessages.set(anchorKey(msg.chat.id, agentCmd.id), sent.message_id);
          evictIfNeeded(replyToAgent);
        });
        return;
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

      // --- Reply-chain routing ---
      const agentId = resolveAgentFromReply(msg);
      if (!agentId) {
        bot!.sendMessage(
          msg.chat.id,
          "Select an agent first (tap the menu button or type /alex, /mia, etc.), then reply to its message.",
        );
        return;
      }

      const def = agentMenu.find((a) => a.id === agentId);
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
  },
};
