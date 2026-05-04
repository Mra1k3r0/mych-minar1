import type { BaseContext } from "@mra1k3r0/gramora";
import { renderTelegramRichText } from "@mra1k3r0/gramora";

type SendMessageArg = Parameters<BaseContext["api"]["sendMessage"]>[0];
type ApiReplyMarkup = NonNullable<SendMessageArg["reply_markup"]>;

/**
 * Prevent accidental italics from plain machine-like tokens (e.g. `last_7_days`).
 * We keep this narrow so normal markdown still works.
 */
function protectUnderscoreTokens(input: string): string {
  return input.replace(
    /(^|[\s(>])([a-z0-9]+(?:_[a-z0-9]+)+)(?=$|[\s).,:;!?])/gi,
    (_m, lead: string, token: string) => `${lead}\`${token}\``,
  );
}

/** Send markdown-like text via Telegram HTML, fallback to plain on failure. */
export async function sendRichText(
  gram: BaseContext,
  markdownLike: string,
  replyMarkup?: ApiReplyMarkup,
): Promise<void> {
  const html = renderTelegramRichText(protectUnderscoreTokens(markdownLike));
  const chatId = gram.chatId;
  const replyTo = gram.message?.message_id;

  if (chatId) {
    try {
      await gram.api.sendMessage({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
        ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
      });
      return;
    } catch {
      // If Telegram rejects HTML, fall through to plain text.
    }
  }

  if (replyMarkup !== undefined) {
    await gram.send(markdownLike, replyMarkup);
  } else {
    await gram.send(markdownLike);
  }
}
