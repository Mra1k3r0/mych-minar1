import { runRps } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_RPS = commandRegistry.register({
  name: "rps",
  description: "Rock paper scissors with buttons",
  group: "fun",
  cooldownSeconds: 2,
  run: runRps,
});
