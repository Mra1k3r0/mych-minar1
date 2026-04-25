import { commandRegistry } from "../registry.js";

export const CMD_START = commandRegistry.register({
  name: "start",
  description: "Welcome message + quick actions",
  group: "core",
});
