import { runDog } from "../../services/fun/cmd.js";
import { commandRegistry } from "../registry.js";

export const CMD_DOG = commandRegistry.register({
  name: "dog",
  description: "Random dog image",
  group: "fun",
  cooldownSeconds: 3,
  run: runDog,
});
