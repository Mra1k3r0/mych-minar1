import { commandRegistry } from "../registry.js";

export const CMD_SLAP = commandRegistry.register({
  name: "slap",
  description: "Send an anime slap reaction",
  group: "fun",
});
