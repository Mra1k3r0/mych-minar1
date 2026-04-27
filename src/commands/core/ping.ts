import { commandRegistry } from "../registry.js";

export const CMD_PING = commandRegistry.register({
  name: "ping",
  description: "Latency check",
  group: "core",
  cooldownSeconds: 1,
  run: async (gram) => {
    const t0 = Date.now();
    await gram.send(`pong (${String(Date.now() - t0)}ms)`);
  },
});
