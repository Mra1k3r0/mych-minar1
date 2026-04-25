import { commandRegistry } from "../registry.js";

export const CMD_PAT = commandRegistry.register({
  name: "pat",
  description: "Send an anime pat reaction",
  group: "fun",
});
