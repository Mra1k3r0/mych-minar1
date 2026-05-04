import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";
import { sendRichText } from "../../services/telegram/rich.js";

type WikiSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
      pageid?: number;
    }>;
  };
};

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const CMD_WIKI = commandRegistry.register({
  name: "wiki",
  description: "Wikipedia search: /wiki <query>",
  group: "core",
  cooldownSeconds: 3,
  run: async (gram) => {
    const query = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!query) {
      await sendRichText(gram, "usage: /wiki <query>");
      return;
    }
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=1`;
    const data = await Fetch<WikiSearchResponse>(url);
    const hit = data?.query?.search?.[0];
    if (hit?.title) {
      const summary = hit.snippet ? stripHtml(hit.snippet) : "No summary available.";
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, "_"))}`;
      await sendRichText(gram, [`📚 *${hit.title}*`, summary, pageUrl].join("\n\n"));
      return;
    }
    await sendRichText(gram, `No Wikipedia result for "${query}".`);
  },
});
