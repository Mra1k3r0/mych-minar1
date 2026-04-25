import { commandRegistry } from "../registry.js";

export const CMD_QUOTE = commandRegistry.register({
  name: "quote",
  description: "Random inspirational quote",
  group: "fun",
});
