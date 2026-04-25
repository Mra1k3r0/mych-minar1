import { Controller, Command } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { config } from "../config.js";
import { conversations, llm } from "../container.js";
import { formatDuration, formatNumber, progressBar } from "../utils/format.js";

@Controller()
export class AdminController {
  @Command("stats")
  async stats(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId || !config.bot.adminIds.includes(userId)) {
      await gram.send("🔒 Admin only.");
      return;
    }

    const stats = llm.stats;
    const rl = llm.rateLimitStatus();

    await gram.send(
      [
        "📊 *Bot Statistics*",
        "",
        "*Uptime*",
        `└ ${formatDuration(stats.uptimeMs)}`,
        "",
        "*API Usage*",
        `├ Total requests: ${formatNumber(stats.totalRequests)}`,
        `├ Total tokens: ${formatNumber(stats.totalTokens)}`,
        `└ Failed requests: ${formatNumber(stats.failedRequests)}`,
        "",
        "*Rate Limits*",
        `├ RPM: ${String(rl.minuteRequests.used)}/${String(rl.minuteRequests.max)} ${progressBar(rl.minuteRequests.used, rl.minuteRequests.max)}`,
        `├ RPD: ${String(rl.dailyRequests.used)}/${String(rl.dailyRequests.max)} ${progressBar(rl.dailyRequests.used, rl.dailyRequests.max)}`,
        `├ TPM: ${formatNumber(rl.minuteTokens.used)}/${formatNumber(rl.minuteTokens.max)} ${progressBar(rl.minuteTokens.used, rl.minuteTokens.max)}`,
        `└ TPD: ${formatNumber(rl.dailyTokens.used)}/${formatNumber(rl.dailyTokens.max)} ${progressBar(rl.dailyTokens.used, rl.dailyTokens.max)}`,
        "",
        "*Conversations*",
        `├ Active: ${String(conversations.activeCount())}`,
        `└ Messages in memory: ${String(conversations.totalMessages())}`,
      ].join("\n"),
    );
  }

  @Command("status")
  async status(gram: BaseContext) {
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
  }
}
