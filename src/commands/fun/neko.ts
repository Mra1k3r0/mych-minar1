import { runNeko } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_NEKO = commandRegistry.register({
  name: "neko",
  description: "Random neko image",
  group: "fun",
  cooldownSeconds: 3,
  run: runNeko,
});
