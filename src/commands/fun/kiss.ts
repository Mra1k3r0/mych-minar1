import { commandRegistry } from "../registry.js";

export const CMD_KISS = commandRegistry.register({
  name: "kiss",
  description: "Send an anime kiss reaction",
  group: "fun",
});
