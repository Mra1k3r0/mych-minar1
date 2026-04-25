import { commandRegistry } from "../registry.js";

export const CMD_AGENT = commandRegistry.register({
  name: "agent",
  description: "Switch to agent mode (tools enabled)",
  group: "ai",
});
