import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";

const FALLBACK_FACTS = [
  "Octopuses have three hearts.",
  "Bananas are berries, but strawberries are not.",
  "Sharks existed before trees.",
  "Honey never really spoils.",
  "A day on Venus is longer than a year on Venus.",
] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CMD_FACT = commandRegistry.register({
  name: "fact",
  description: "Random fun fact",
  group: "fun",
  cooldownSeconds: 3,
  run: async (gram) => {
    const data = await Fetch<{ text?: string }>(
      "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en",
    );
    if (data?.text) {
      await gram.reply(data.text);
      return;
    }
    await gram.reply(pick(FALLBACK_FACTS));
  },
});
