import { commandRegistry } from "../registry.js";

export const CMD_DOG = commandRegistry.register({
  name: "dog",
  description: "Random dog image",
  group: "fun",
});
