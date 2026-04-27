import { commandRegistry } from "../registry.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const CMD_CHATINFO = commandRegistry.register({
  name: "chatinfo",
  description: "Show current chat info",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    const chat = asRecord(asRecord((gram as unknown as UnknownRecord).message)?.chat);
    const chatId = getNumber(chat?.id) ?? gram.chatId;
    const title = getString(chat?.title);
    const type = getString(chat?.type);
    const username = getString(chat?.username);

    await gram.send(
      [
        "💬 *Chat Info*",
        `Chat ID: \`${String(chatId ?? "n/a")}\``,
        `Title: ${title ?? "private chat"}`,
        `Type: ${type ?? "unknown"}`,
        `Username: @${username ?? "none"}`,
      ].join("\n"),
    );
  },
});
