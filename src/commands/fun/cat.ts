import { commandRegistry } from "../registry.js";

export const CMD_CAT = commandRegistry.register({
  name: "cat",
  description: "Random cat image",
  group: "fun",
});
