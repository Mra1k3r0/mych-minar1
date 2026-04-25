import { commandRegistry } from "../registry.js";

export const CMD_STATUS = commandRegistry.register({
  name: "status",
  description: "Show current model + rate limits",
  group: "admin",
});
