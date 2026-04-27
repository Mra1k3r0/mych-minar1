import { runCat } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_CAT = commandRegistry.register({
  name: "cat",
  description: "Random cat image",
  group: "fun",
  cooldownSeconds: 3,
  run: runCat,
});
