import { commandRegistry } from "../registry.js";

export const CMD_MEME = commandRegistry.register({
  name: "meme",
  description: "Random meme image",
  group: "fun",
});
