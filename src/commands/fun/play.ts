import { commandRegistry } from "../registry.js";

export const CMD_PLAY = commandRegistry.register({
  name: "play",
  description: "Music from YouTube: /play <query or url>",
  group: "fun",
});
