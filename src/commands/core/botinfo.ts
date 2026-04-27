import { config } from "../../config.js";
import { commandRegistry } from "../registry.js";

export const CMD_BOTINFO = commandRegistry.register({
  name: "botinfo",
  description: "Show bot runtime information",
  group: "core",
  cooldownSeconds: 3,
  run: async (gram) => {
    await gram.send(
      [
        "🤖 *Bot Info*",
        `Name: minar1`,
        `Provider: \`${config.llm.provider}\``,
        `Model: \`${config.llm.model}\``,
        `Mode: ${config.bot.lowTokenMode}`,
        `User RPM limit: ${String(config.bot.telegramUserRpmLimit)}`,
      ].join("\n"),
    );
  },
});
