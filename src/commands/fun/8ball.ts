import { commandRegistry } from "../registry.js";

export const CMD_8BALL = commandRegistry.register({
  name: "8ball",
  description: "Ask the magic 8ball",
  group: "fun",
});
