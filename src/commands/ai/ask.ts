import { commandRegistry } from "../registry.js";

export const CMD_ASK = commandRegistry.register({
  name: "ask",
  description: "One-shot question (no memory)",
  group: "ai",
});
