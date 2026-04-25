import { commandRegistry } from "../registry.js";

export const CMD_ROLL = commandRegistry.register({
  name: "roll",
  description: "Roll dice, e.g. /roll 1d20",
  group: "fun",
});
