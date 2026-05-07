import { commandRegistry } from "../registry.js";

export const CMD_PING = commandRegistry.register({
  name: "ping",
  description: "Latency check",
  group: "core",
  cooldownSeconds: 1,
  run: async (gram) => {
    const started = Date.now();
    const chatId = gram.chatId;
    const replyTo = gram.message?.message_id;
    if (!chatId) {
      // Fallback: still avoids the old "0ms template" bug.
      const ms = Date.now() - started;
      await gram.send(`pong (${String(ms)}ms)`);
      return;
    }

    // 1) send message via Telegram API and measure real send latency
    const sent = await gram.api.sendMessage({
      chat_id: chatId,
      text: "pong...",
      ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
    });
    const sendMs = Date.now() - started;

    // 2) optional cheap API call to give an additional "bot->telegram" estimate
    let apiMs: number | null = null;
    try {
      const apiStarted = Date.now();
      await gram.api.getMe();
      apiMs = Date.now() - apiStarted;
    } catch {
      // Ignore API latency if this ping is running without API access.
    }

    const messageId =
      typeof (sent as unknown as { message_id?: number }).message_id === "number"
        ? (sent as unknown as { message_id: number }).message_id
        : undefined;
    if (messageId) {
      await gram.editText({
        messageId,
        text:
          apiMs !== null
            ? `pong (${String(sendMs)}ms • api ${String(apiMs)}ms)`
            : `pong (${String(sendMs)}ms)`,
      });
      return;
    }

    // Last resort if we can't extract the message id.
    await gram.api.sendMessage({
      chat_id: chatId,
      text:
        apiMs !== null
          ? `pong (${String(sendMs)}ms • api ${String(apiMs)}ms)`
          : `pong (${String(sendMs)}ms)`,
      ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
    });
  },
});
