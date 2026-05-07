import { commandRegistry } from "../registry.js";
import { aiCommandBridge } from "../../services/ai/bridge.js";

export const CMD_CLEAR = commandRegistry.register({
  name: "clear",
  description: "Clear conversation history",
  group: "ai",
  run: async (gram) => {
    if (!aiCommandBridge.clear) {
      await gram.send("AI command runtime is not ready yet. Please try again.");
      return;
    }
    await aiCommandBridge.clear(gram);
  },
});
