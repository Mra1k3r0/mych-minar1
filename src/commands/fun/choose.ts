import { commandRegistry } from "../registry.js";

export const CMD_CHOOSE = commandRegistry.register({
  name: "choose",
  description: "Pick one option: /choose a | b | c",
  group: "fun",
});
