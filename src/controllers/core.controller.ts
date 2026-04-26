import { Controller, Command, CallbackQuery } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { Keyboard } from "@mra1k3r0/gramora";
import { config } from "../config.js";
import { commandRegistry } from "../commands/index.js";
import { formatDuration } from "../utils/format.js";

const startedAt = Date.now();

@Controller()
export class CoreController {
  @Command("start")
  async start(gram: BaseContext) {
    const userId = gram.fromId;
    const isAdmin = userId ? config.bot.adminIds.includes(userId) : false;
    const name = gram.message?.from?.first_name ?? "there";

    const kb = Keyboard.inline()
      .text("💬 Chat mode", "mode:chat")
      .text("🤖 Agent mode", "mode:agent")
      .row();

    if (isAdmin) {
      kb.text("📊 Status", "cmd:status");
    }
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

    if (isAdmin) {
      lines.push("• /status — budgets / readiness");
    }
    lines.push("• /help — all commands");

    await gram.send(lines.join("\n"), kb.build());
  }

  @Command("help")
  async help(gram: BaseContext) {
    const lines = commandRegistry.all().map((c) => `/${c.name} — ${c.description}`);

    await gram.send(["*Commands*", "", ...lines].join("\n"));
  }

  @Command("ping")
  async ping(gram: BaseContext) {
    const t0 = Date.now();
    await gram.send(`pong (${String(Date.now() - t0)}ms)`);
  }

  @Command("uptime")
  async uptime(gram: BaseContext) {
    await gram.send(`📈 Uptime: ${formatDuration(Date.now() - startedAt)}`);
  }

  @Command("id")
  async id(gram: BaseContext) {
    await gram.send(
      [
        "🆔 *Your info*",
        `Chat ID: \`${String(gram.chatId ?? "n/a")}\``,
        `User ID: \`${String(gram.fromId ?? "n/a")}\``,
        `Name: ${gram.message?.from?.first_name ?? "unknown"}`,
        `Username: @${gram.message?.from?.username ?? "none"}`,
      ].join("\n"),
    );
  }

  @CallbackQuery("cmd:*")
  async cmdCallbacks(gram: BaseContext) {
    const action = gram.match?.[0];
    if (!action) return;
    await gram.answer();

    if (action === "help") await gram.send("Use /help to see all commands.");
    if (action === "status") await gram.send("Use /status to see bot status.");
  }
}
