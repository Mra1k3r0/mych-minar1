import { commandRegistry } from "../registry.js";
import { aiCommandBridge } from "../../controllers/ai.controller.js";

export const CMD_ASK = commandRegistry.register({
  name: "ask",
  description: "One-shot question (no memory)",
  group: "ai",
  cooldownSeconds: 2,
  run: async (gram) => {
    if (!aiCommandBridge.ask) {
      await gram.send("AI command runtime is not ready yet. Please try again.");
      return;
    }
    await aiCommandBridge.ask(gram);
  },
});
