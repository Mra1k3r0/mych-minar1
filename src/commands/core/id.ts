import { sendRichText } from "../../services/telegram/rich.js";
import { commandRegistry } from "../registry.js";

export const CMD_ID = commandRegistry.register({
  name: "id",
  description: "Show your chat/user IDs",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    await sendRichText(
      gram,
      [
        "🆔 **Your info**",
        `Chat ID: \`${String(gram.chatId ?? "n/a")}\``,
        `User ID: \`${String(gram.fromId ?? "n/a")}\``,
        `Name: ${gram.message?.from?.first_name ?? "unknown"}`,
        `Username: @${gram.message?.from?.username ?? "none"}`,
      ].join("\n"),
    );
  },
});
