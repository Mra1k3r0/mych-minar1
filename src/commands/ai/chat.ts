import { commandRegistry } from "../registry.js";

export const CMD_CHAT = commandRegistry.register({
  name: "chat",
  description: "Switch to chat mode",
  group: "ai",
});
