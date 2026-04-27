import { commandRegistry } from "../registry.js";
import { aiCommandBridge } from "../../controllers/ai.controller.js";

export const CMD_CHAT = commandRegistry.register({
  name: "chat",
  description: "Switch to chat mode",
  group: "ai",
  run: async (gram) => {
    if (!aiCommandBridge.chat) {
      await gram.send("AI command runtime is not ready yet. Please try again.");
      return;
    }
    await aiCommandBridge.chat(gram);
  },
});
