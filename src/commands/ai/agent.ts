import { commandRegistry } from "../registry.js";
import { aiCommandBridge } from "../../controllers/ai.controller.js";

export const CMD_AGENT = commandRegistry.register({
  name: "agent",
  description: "Switch to agent mode (tools enabled)",
  group: "ai",
  run: async (gram) => {
    if (!aiCommandBridge.agent) {
      await gram.send("AI command runtime is not ready yet. Please try again.");
      return;
    }
    await aiCommandBridge.agent(gram);
  },
});
