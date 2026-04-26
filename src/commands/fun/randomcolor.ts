import { commandRegistry } from "../registry.js";

export const CMD_RANDOMCOLOR = commandRegistry.register({
  name: "randomcolor",
  description: "Random color card from Popcat",
  group: "fun",
});
