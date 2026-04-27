import { commandRegistry } from "../registry.js";
import { runPlay } from "../../services/fun/yt.js";

export const CMD_PLAY = commandRegistry.register({
  name: "play",
  description: "Music from YouTube: /play <query or url>",
  group: "fun",
  cooldownSeconds: 5,
  run: runPlay,
});
