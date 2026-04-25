import { commandRegistry } from "../registry.js";

export const CMD_PING = commandRegistry.register({
  name: "ping",
  description: "Latency check",
  group: "core",
});
