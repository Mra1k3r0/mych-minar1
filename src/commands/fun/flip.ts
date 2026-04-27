import { randomInt } from "node:crypto";
import { commandRegistry } from "../registry.js";

export const CMD_FLIP = commandRegistry.register({
  name: "flip",
  description: "Flip a coin",
  group: "fun",
  cooldownSeconds: 1,
  run: async (gram) => {
    await gram.reply(randomInt(2) === 0 ? "heads" : "tails");
  },
});
