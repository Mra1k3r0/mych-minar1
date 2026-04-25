import { commandRegistry } from "../registry.js";

export const CMD_ID = commandRegistry.register({
  name: "id",
  description: "Show your chat/user IDs",
  group: "core",
});
