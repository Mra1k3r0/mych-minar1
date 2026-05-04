import { conversations, llm } from "../../container.js";
import { sendRichText } from "../../services/telegram/rich.js";
import { formatDuration, formatNumber, progressBar } from "../../utils/format.js";
import { commandRegistry } from "../registry.js";

export const CMD_STATS = commandRegistry.register({
  name: "stats",
  description: "Admin: usage and budgets",
  group: "admin",
  admin: true,
  perm: 1,
  cooldownSeconds: 8,
  run: async (gram) => {
    const stats = llm.stats;
    const rl = llm.rateLimitStatus();

    await sendRichText(
      gram,
      [
        "📊 **Bot Statistics**",
        "",
        "**Uptime**",
        `└ ${formatDuration(stats.uptimeMs)}`,
        "",
        "**API Usage**",
        `├ Total requests: ${formatNumber(stats.totalRequests)}`,
        `├ Total tokens: ${formatNumber(stats.totalTokens)}`,
        `└ Failed requests: ${formatNumber(stats.failedRequests)}`,
        "",
        "**Rate Limits**",
        `├ RPM: ${String(rl.minuteRequests.used)}/${String(rl.minuteRequests.max)} ${progressBar(rl.minuteRequests.used, rl.minuteRequests.max)}`,
        `├ RPD: ${String(rl.dailyRequests.used)}/${String(rl.dailyRequests.max)} ${progressBar(rl.dailyRequests.used, rl.dailyRequests.max)}`,
        `├ TPM: ${formatNumber(rl.minuteTokens.used)}/${formatNumber(rl.minuteTokens.max)} ${progressBar(rl.minuteTokens.used, rl.minuteTokens.max)}`,
        `└ TPD: ${formatNumber(rl.dailyTokens.used)}/${formatNumber(rl.dailyTokens.max)} ${progressBar(rl.dailyTokens.used, rl.dailyTokens.max)}`,
        "",
        "**Conversations**",
        `├ Active: ${String(conversations.activeCount())}`,
        `└ Messages in memory: ${String(conversations.totalMessages())}`,
      ].join("\n"),
    );
  },
});
