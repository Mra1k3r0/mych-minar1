import { commandRegistry } from "../registry.js";

export const CMD_NEKO = commandRegistry.register({
  name: "neko",
  description: "Random neko image",
  group: "fun",
});
