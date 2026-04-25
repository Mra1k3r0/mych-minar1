import { commandRegistry } from "../registry.js";

export const CMD_STATS = commandRegistry.register({
  name: "stats",
  description: "Admin: usage and budgets",
  group: "admin",
});
