import { commandRegistry } from "../registry.js";

export const CMD_RESTART = commandRegistry.register({
  name: "restart",
  description: "Admin: restart process (needs PM2/Docker/systemd)",
  group: "admin",
  admin: true,
  perm: 1,
  cooldownSeconds: 10,
  run: async (gram) => {
    await gram.send("🔁 Restarting process...");
    setTimeout(() => {
      process.exit(0);
    }, 200);
  },
});
