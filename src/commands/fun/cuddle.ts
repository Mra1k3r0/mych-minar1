import { runCuddle } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_CUDDLE = commandRegistry.register({
  name: "cuddle",
  description: "Send an anime cuddle reaction",
  group: "fun",
  cooldownSeconds: 2,
  run: runCuddle,
});
