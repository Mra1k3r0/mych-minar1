import { commandRegistry } from "../registry.js";

export const CMD_VIDEO = commandRegistry.register({
  name: "video",
  description: "Video from YouTube: /video <query or url>",
  group: "fun",
});
