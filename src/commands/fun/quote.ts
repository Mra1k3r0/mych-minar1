import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";

const FALLBACK_QUOTES = [
  "Small steps daily > random big bursts.",
  "Discipline is just self-respect in action.",
  "Make it work, then make it clean.",
  "Done is better than perfect.",
  "Consistency builds unfair advantage.",
] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CMD_QUOTE = commandRegistry.register({
  name: "quote",
  description: "Random inspirational quote",
  group: "fun",
  cooldownSeconds: 3,
  run: async (gram) => {
    const data = await Fetch<Array<{ q?: string; a?: string }>>(
      "https://zenquotes.io/api/quotes/random?",
    );
    const quote = data?.at(0);
    if (quote?.q) {
      await gram.reply(`"${quote.q}"\n— ${quote.a ?? "Unknown"}`);
      return;
    }
    await gram.reply(`"${pick(FALLBACK_QUOTES)}"\n— Unknown`);
  },
});
