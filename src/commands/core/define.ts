import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";
import { sendRichText } from "../../services/telegram/rich.js";

type DictEntry = {
  word?: string;
  phonetic?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

export const CMD_DEFINE = commandRegistry.register({
  name: "define",
  description: "Dictionary lookup: /define <word>",
  group: "core",
  cooldownSeconds: 3,
  run: async (gram) => {
    const raw = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!raw) {
      await sendRichText(gram, "usage: /define <word>");
      return;
    }

    const data = await Fetch<DictEntry[]>(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(raw)}`,
    );
    if (data?.length) {
      const top = data[0];
      const meaning = top.meanings?.[0];
      const def = meaning?.definitions?.[0];
      if (top.word && def?.definition) {
        await sendRichText(
          gram,
          [
            `📘 *${top.word}* ${top.phonetic ? `(${top.phonetic})` : ""}`.trim(),
            meaning?.partOfSpeech ? `part of speech: ${meaning.partOfSpeech}` : "",
            `definition: ${def.definition}`,
            def.example ? `example: ${def.example}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }
    }

    await sendRichText(gram, `No definition found for "${raw}".`);
  },
});
