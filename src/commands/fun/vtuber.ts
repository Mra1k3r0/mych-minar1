import { commandRegistry } from "../registry.js";

export const CMD_VTUBER = commandRegistry.register({
  name: "vtuber",
  description: "Random VTuber images: /vtuber [name|random] [1-3]",
  group: "fun",
});
