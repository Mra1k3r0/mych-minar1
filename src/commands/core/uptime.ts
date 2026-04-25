import { commandRegistry } from "../registry.js";

export const CMD_UPTIME = commandRegistry.register({
  name: "uptime",
  description: "Show bot uptime",
  group: "core",
});
