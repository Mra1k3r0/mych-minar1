import { runHug } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_HUG = commandRegistry.register({
  name: "hug",
  description: "Send an anime hug reaction",
  group: "fun",
  cooldownSeconds: 2,
  run: runHug,
});
