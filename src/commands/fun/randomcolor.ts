import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";

const FALLBACK_COLORS = [
  { hex: "FF6B6B", name: "Coral Burst" },
  { hex: "4ECDC4", name: "Mint Wave" },
  { hex: "556270", name: "Slate Breeze" },
  { hex: "C7F464", name: "Lime Glow" },
  { hex: "C44D58", name: "Crimson Pop" },
] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CMD_RANDOMCOLOR = commandRegistry.register({
  name: "randomcolor",
  description: "Random color card from Popcat",
  group: "fun",
  cooldownSeconds: 3,
  run: async (gram) => {
    const replyTo = gram.message?.message_id;
    const data = await Fetch<{ hex?: string; name?: string; image?: string }>(
      "https://api.popcat.xyz/randomcolor",
    );
    if (data) {
      const hex = (data.hex ?? "").trim().replace(/^#/, "").toUpperCase();
      const name = (data.name ?? "").trim();
      const image = (data.image ?? "").trim();
      if (hex && name && image) {
        await gram.photo({
          photo: image,
          caption: `${name}\n#${hex}`,
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        return;
      }
    }
    const fallback = pick(FALLBACK_COLORS);
    await gram.send({
      text: `${fallback.name}\n#${fallback.hex}`,
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
  },
});
