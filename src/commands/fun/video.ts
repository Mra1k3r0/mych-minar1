import { commandRegistry } from "../registry.js";
import { runVideo } from "../../services/fun/yt.js";

export const CMD_VIDEO = commandRegistry.register({
  name: "video",
  description: "Video from YouTube: /video <query or url>",
  group: "fun",
  cooldownSeconds: 6,
  run: runVideo,
});
