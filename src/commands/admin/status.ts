import { config } from "../../config.js";
import { conversations, llm } from "../../container.js";
import { formatDuration, formatNumber } from "../../utils/format.js";
import { commandRegistry } from "../registry.js";

export const CMD_STATUS = commandRegistry.register({
  name: "status",
  description: "Show current model + rate limits",
  group: "admin",
  admin: true,
  perm: 1,
  cooldownSeconds: 5,
  run: async (gram) => {
    const stats = llm.stats;
    const rl = llm.rateLimitStatus();
    const healthEmoji = rl.canProceed ? "🟢" : "🔴";
    const tokenPct = Math.round((rl.dailyTokens.used / rl.dailyTokens.max) * 100);
    const reqPct = Math.round((rl.dailyRequests.used / rl.dailyRequests.max) * 100);

    await gram.send(
      [
        `${healthEmoji} *Bot Status*`,
        "",
        `⏱ Uptime: ${formatDuration(stats.uptimeMs)}`,
        `🤖 Provider: \`${config.llm.provider}\``,
        `🤖 Model: \`${config.llm.model}\``,
        `💬 Active chats: ${String(conversations.activeCount())}`,
        "",
        "*Daily budget*",
        `├ Requests: ${String(rl.dailyRequests.used)}/${String(rl.dailyRequests.max)} (${String(reqPct)}%)`,
        `└ Tokens: ${formatNumber(rl.dailyTokens.used)}/${formatNumber(rl.dailyTokens.max)} (${String(tokenPct)}%)`,
        "",
        rl.canProceed
          ? "✅ Ready"
          : `⏳ Rate limited — retry in ~${String(Math.ceil(rl.retryAfterMs / 1000))}s`,
      ].join("\n"),
    );
  },
});
