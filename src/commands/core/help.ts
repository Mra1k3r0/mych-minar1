import { commandRegistry } from "../registry.js";
import { findClosestCommandName } from "../suggest.js";
import { sendRichText } from "../../services/telegram/rich.js";

export const CMD_HELP = commandRegistry.register({
  name: "help",
  description: "Show all commands",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    const arg = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim().toLowerCase();
    if (arg) {
      const command = commandRegistry.get(arg);
      if (command) {
        const details = [
          `/${command.name}`,
          command.description,
          "",
          `group: ${command.group}`,
          `admin: ${command.admin ? "true" : "false"}`,
          `perm: ${String(command.perm ?? (command.admin ? 1 : 0))}`,
          `cooldown: ${String(command.cooldownSeconds ?? 0)}s`,
        ];
        await sendRichText(gram, details.join("\n"));
        return;
      }
      const suggestion = findClosestCommandName(arg, commandRegistry.all());
      if (suggestion) {
        await sendRichText(gram, `"${arg}" isnt available. you mean "/${suggestion}"?`);
        return;
      }
      await sendRichText(gram, `"${arg}" isnt available.`);
      return;
    }
    const lines = commandRegistry.all().map((c) => `/${c.name} — ${c.description}`);
    await sendRichText(gram, ["**Commands**", "", ...lines].join("\n"));
  },
});
