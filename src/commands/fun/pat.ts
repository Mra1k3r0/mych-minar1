import { runPat } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_PAT = commandRegistry.register({
  name: "pat",
  description: "Send an anime pat reaction",
  group: "fun",
  cooldownSeconds: 2,
  run: runPat,
});
