import { commandRegistry } from "../registry.js";

export const CMD_FLIP = commandRegistry.register({
  name: "flip",
  description: "Flip a coin",
  group: "fun",
});
