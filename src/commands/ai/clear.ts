import { commandRegistry } from "../registry.js";

export const CMD_CLEAR = commandRegistry.register({
  name: "clear",
  description: "Clear conversation history",
  group: "ai",
});
