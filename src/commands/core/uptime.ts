import { formatDuration } from "../../utils/format.js";
import { commandRegistry } from "../registry.js";

const startedAt = Date.now();

export const CMD_UPTIME = commandRegistry.register({
  name: "uptime",
  description: "Show bot uptime",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    await gram.send(`📈 Uptime: ${formatDuration(Date.now() - startedAt)}`);
  },
});
