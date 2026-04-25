import type { BaseContext } from "@mra1k3r0/gramora";

export function buildTelegramContext(gram: BaseContext): string {
  const from = gram.message?.from ?? gram.callbackQuery?.from ?? gram.inlineQuery?.from;
  const chat = gram.message?.chat ?? gram.callbackQuery?.message?.chat;

  const parts: string[] = [];
  parts.push("Telegram context (trusted):");

  if (from) {
    const username = typeof from.username === "string" ? from.username : "n/a";
    parts.push(
      `- user: id=${String(from.id)} name=${[from.first_name, from.last_name].filter(Boolean).join(" ") || "n/a"} username=@${username}`,
    );
    if (typeof from.language_code === "string") parts.push(`- user_lang: ${from.language_code}`);
  }

  if (chat) {
    // type is not always present in older types; keep defensive
    const chatType = (chat as { type?: string }).type ?? "n/a";
    const chatUsername = (chat as { username?: string }).username;
    parts.push(
      `- chat: id=${String(chat.id)} type=${chatType} title=${(chat as { title?: string }).title ?? "n/a"}`,
    );
    if (typeof chatUsername === "string") parts.push(`- chat_username: @${chatUsername}`);
  }

  parts.push(
    "If the user asks for their username/id/chat info, answer using this context without guessing.",
  );
  return parts.join("\n");
}
