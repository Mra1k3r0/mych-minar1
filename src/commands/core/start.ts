import { Keyboard } from "@mra1k3r0/gramora";
import { config } from "../../config.js";
import { sendRichText } from "../../services/telegram/rich.js";
import { commandRegistry } from "../registry.js";

export const CMD_START = commandRegistry.register({
  name: "start",
  description: "Welcome message + quick actions",
  group: "core",
  cooldownSeconds: 2,
  run: async (gram) => {
    const userId = gram.fromId;
    const isAdmin = userId ? config.bot.adminIds.includes(userId) : false;
    const name = gram.message?.from?.first_name ?? "there";

    const kb = Keyboard.inline()
      .text("💬 Chat mode", "mode:chat")
      .text("🤖 Agent mode", "mode:agent")
      .row();

    if (isAdmin) kb.text("📊 Status", "cmd:status");
    kb.text("❓ Help", "cmd:help");

    const lines = [
      `Yo ${name} — I'm *minar1* running on *${config.llm.model}*.`,
      "Built by *mra1k3r0* (John Paul Caigas).",
      "",
      "Quick actions:",
      "• /chat — normal conversation",
      "• /agent — tool-using agent mode",
      "• /ask <q> — one-shot (no memory)",
    ];
    if (isAdmin) lines.push("• /status — budgets / readiness");
    lines.push("• /help — all commands");

    await sendRichText(gram, lines.join("\n"), kb.build());
  },
});
