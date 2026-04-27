import { runMeme } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_MEME = commandRegistry.register({
  name: "meme",
  description: "Random meme image",
  group: "fun",
  cooldownSeconds: 3,
  run: runMeme,
});
