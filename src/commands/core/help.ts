import { commandRegistry } from "../registry.js";

export const CMD_HELP = commandRegistry.register({
  name: "help",
  description: "Show all commands",
  group: "core",
});
