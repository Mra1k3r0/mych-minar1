import { renderTelegramRichText } from "@mra1k3r0/gramora";
import { sendRichText } from "../../services/telegram/rich.js";
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

type TgPhotoSize = { file_id?: string };
type TgUserProfilePhotos = { photos?: TgPhotoSize[][] };

export const CMD_USERINFO = commandRegistry.register({
  name: "userinfo",
  description: "Show profile info (you or replied user)",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    const msg = asRecord((gram as unknown as UnknownRecord).message);
    const replied = asRecord(asRecord(msg?.reply_to_message)?.from);
    const from = asRecord(msg?.from);
    const target = replied ?? from;

    const id = getNumber(target?.id);
    const username = getString(target?.username);
    const firstName = getString(target?.first_name);
    const lastName = getString(target?.last_name);
    const isBot = target?.is_bot === true;

    const text = [
      "👤 **User Info**",
      `ID: \`${String(id ?? gram.fromId ?? "n/a")}\``,
      `Username: @${username ?? "none"}`,
      `First name: ${firstName ?? "unknown"}`,
      `Last name: ${lastName ?? "none"}`,
      `Type: ${isBot ? "bot" : "user"}`,
    ].join("\n");

    if (id !== undefined && gram.chatId) {
      try {
        const api = gram.api as unknown as {
          getUserProfilePhotos: (payload: {
            user_id: number;
            limit?: number;
          }) => Promise<TgUserProfilePhotos>;
          sendPhoto: (payload: {
            chat_id: number | string;
            photo: string;
            caption?: string;
            parse_mode?: "HTML";
          }) => Promise<unknown>;
        };
        const photos = await api.getUserProfilePhotos({ user_id: id, limit: 1 });
        const fileId = photos.photos?.[0]?.[0]?.file_id;
        if (typeof fileId === "string" && fileId.length > 0) {
          await api.sendPhoto({
            chat_id: gram.chatId,
            photo: fileId,
            caption: renderTelegramRichText(text),
            parse_mode: "HTML",
          });
          return;
        }
      } catch {
        // If lookup/send fails, fall back to text response.
      }
    }

    await sendRichText(gram, text);
  },
});
