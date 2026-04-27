import { randomInt } from "node:crypto";
import { commandRegistry } from "../registry.js";

export const CMD_ROLL = commandRegistry.register({
  name: "roll",
  description: "Roll dice, e.g. /roll 1d20",
  group: "fun",
  cooldownSeconds: 2,
  run: async (gram) => {
    const arg = (gram.text ?? "").split(/\s+/).slice(1).join("").trim() || "1d6";
    const m = arg.match(/^(\d{1,2})d(\d{1,4})$/i);
    if (!m) {
      await gram.reply("usage: /roll 1d20");
      return;
    }
    const count = Number(m[1]);
    const sides = Number(m[2]);
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) {
      await gram.reply("use sane dice limits: count 1-20, sides 2-1000.");
      return;
    }
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const total = rolls.reduce((a, b) => a + b, 0);
    await gram.reply(
      count === 1 ? String(rolls[0]) : `${rolls.join(", ")} (total: ${String(total)})`,
    );
  },
});
