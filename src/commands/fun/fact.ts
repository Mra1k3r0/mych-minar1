import { commandRegistry } from "../registry.js";

export const CMD_FACT = commandRegistry.register({
  name: "fact",
  description: "Random fun fact",
  group: "fun",
});
