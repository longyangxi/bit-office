import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { nanoid } from "nanoid";
import type { GatewayEvent, Command } from "@office/shared";
import type { Channel } from "./transport.js";

/** Same order as AGENT_PRESETS in packages/shared/src/presets.ts */
const PRESETS = [
  { name: "Alex",   role: "Frontend Dev",  palette: 0, personality: "You speak in a friendly, casual, encouraging, and natural tone." },
  { name: "Mia",    role: "Backend Dev",   palette: 1, personality: "You speak formally, professionally, in an organized and concise manner." },
  { name: "Leo",    role: "Fullstack Dev", palette: 2, personality: "You are aggressive, action-first, always pursuing speed and efficiency." },
  { name: "Sophie", role: "Code Reviewer", palette: 3, personality: "You teach patiently, explain the reasoning, and guide like a mentor." },
  { name: "Kai",    role: "Game Dev",      palette: 4, personality: "You are enthusiastic, creative, and obsessive about game feel." },
  { name: "Marcus", role: "Team Lead",     palette: 5, personality: "You have strong product intuition and communicate with clarity and vision." },
];

interface BotAgent {
  bot: TelegramBot;
  preset: typeof PRESETS[number];
  agentId: string;
  chatIds: Set<number>;
}

const botAgents: BotAgent[] = [];

/** Format event as readable Telegram message */
function formatEvent(event: GatewayEvent, agentId: string): string | null {
  if (event.type === "TASK_STARTED" && event.agentId === agentId) {
    return `🔧 Working on it...`;
  }
  if (event.type === "TASK_DONE" && event.agentId === agentId) {
    const r = event.result;
    let msg = `✅ Task completed\n\n${r.summary}`;
    if (r.changedFiles.length > 0) {
      msg += `\n\n📁 Changed files:\n${r.changedFiles.map((f: string) => `• ${f}`).join("\n")}`;
    }
    return msg;
  }
  if (event.type === "TASK_FAILED" && event.agentId === agentId) {
    return `❌ Task failed\n\n${event.error}`;
  }
  if (event.type === "APPROVAL_NEEDED" && event.agentId === agentId) {
    return `⚠️ Approval needed\n\n${event.title}\n${event.summary}\n\nReply /yes or /no`;
  }
  return null;
}

export const telegramChannel: Channel = {
  name: "Telegram",

  async init(commandHandler: (cmd: Command) => void): Promise<boolean> {
    const tokens = config.telegramBotTokens;
    if (!tokens.length || tokens.every((t) => !t)) return false;

    for (let i = 0; i < tokens.length && i < PRESETS.length; i++) {
      const token = tokens[i];
      if (!token) continue;

      const preset = PRESETS[i];
      const agentId = `tg-${preset.name.toLowerCase()}`;

      const bot = new TelegramBot(token, { polling: true });
      const ba: BotAgent = { bot, preset, agentId, chatIds: new Set() };
      botAgents.push(ba);

      // Guard against 409 Conflict (another instance polling the same token)
      bot.on("polling_error", (err: any) => {
        const code = err?.response?.statusCode ?? err?.code;
        if (code === 409) {
          console.warn(
            `[Telegram] 409 Conflict for @${preset.name}: token is already used by another bot instance. Polling skipped for this token.`
          );
          bot.stopPolling();
          return;
        }
        console.error(`[Telegram] Polling error for @${preset.name}:`, err.message ?? err);
      });

      // Auto-create agent via command handler (ensures palette/backend are stored)
      commandHandler({
        type: "CREATE_AGENT",
        agentId,
        name: preset.name,
        role: preset.role,
        palette: preset.palette,
        personality: preset.personality,
      });

      const botInfo = await bot.getMe();
      console.log(`[Telegram] @${botInfo.username} → ${preset.name} (${preset.role})`);

      // Track chat IDs + handle commands and messages
      bot.on("message", (msg) => {
        if (!msg.text) return;
        ba.chatIds.add(msg.chat.id);

        const text = msg.text.trim();

        // Commands
        if (text === "/yes") {
          commandHandler({ type: "APPROVAL_DECISION", approvalId: "__all__", decision: "yes" });
          return;
        }
        if (text === "/no") {
          commandHandler({ type: "APPROVAL_DECISION", approvalId: "__all__", decision: "no" });
          return;
        }
        if (text === "/cancel") {
          commandHandler({ type: "CANCEL_TASK", agentId, taskId: "" });
          bot.sendMessage(msg.chat.id, `🛑 Cancelled ${preset.name}'s current task`);
          return;
        }
        if (text === "/status") {
          // Trigger a PING to re-broadcast all statuses
          commandHandler({ type: "PING" });
          return;
        }
        if (text.startsWith("/")) return; // ignore other commands

        const taskId = nanoid();
        commandHandler({
          type: "RUN_TASK",
          agentId,
          taskId,
          prompt: text,
          name: preset.name,
          role: preset.role,
          personality: preset.personality,
        });
      });
    }

    console.log(`[Telegram] ${botAgents.length} bot(s) active`);
    return botAgents.length > 0;
  },

  broadcast(event: GatewayEvent) {
    for (const ba of botAgents) {
      const text = formatEvent(event, ba.agentId);
      if (!text) continue;

      for (const chatId of ba.chatIds) {
        ba.bot.sendMessage(chatId, text).catch((err: Error) => {
          console.error(`[Telegram] Send failed:`, err.message);
        });
      }
    }
  },

  destroy() {
    for (const ba of botAgents) {
      ba.bot.stopPolling();
    }
    botAgents.length = 0;
  },
};
