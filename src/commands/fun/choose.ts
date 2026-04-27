import { commandRegistry } from "../registry.js";

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CMD_CHOOSE = commandRegistry.register({
  name: "choose",
  description: "Pick one option: /choose a | b | c",
  group: "fun",
  cooldownSeconds: 2,
  run: async (gram) => {
    const raw = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    const options = raw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const fallbackOptions =
      options.length >= 2
        ? options
        : raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    if (fallbackOptions.length < 2) {
      await gram.reply("usage: /choose pizza | burger | ramen");
      return;
    }
    await gram.reply(pick(fallbackOptions));
  },
});
