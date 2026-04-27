import { commandRegistry } from "../registry.js";

const EIGHT_BALL = [
  "Yes.",
  "No.",
  "Big yes.",
  "Probably.",
  "Not now.",
  "Ask again later.",
  "Low-key yes.",
  "Absolutely not.",
  "Vibes say yes.",
  "Outcome uncertain.",
] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CMD_8BALL = commandRegistry.register({
  name: "8ball",
  description: "Ask the magic 8ball",
  group: "fun",
  cooldownSeconds: 2,
  run: async (gram) => {
    const q = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!q) {
      await gram.reply("usage: /8ball <question>");
      return;
    }
    await gram.reply(pick(EIGHT_BALL));
  },
});
