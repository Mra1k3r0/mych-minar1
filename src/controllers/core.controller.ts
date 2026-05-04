import { Controller, Command, CallbackQuery } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { commandRegistry } from "../commands/index.js";
import {
  handleGooglePick,
  handleGoogleQaPick,
  handleGoogleSection,
} from "../commands/core/google.js";
import { sendRichText } from "../services/telegram/rich.js";

@Controller()
export class CoreController {
  @Command("start")
  async start(gram: BaseContext) {
    await commandRegistry.run("start", gram);
  }

  @Command("help")
  async help(gram: BaseContext) {
    await commandRegistry.run("help", gram);
  }

  @Command("ping")
  async ping(gram: BaseContext) {
    await commandRegistry.run("ping", gram);
  }

  @Command("uptime")
  async uptime(gram: BaseContext) {
    await commandRegistry.run("uptime", gram);
  }

  @Command("id")
  async id(gram: BaseContext) {
    await commandRegistry.run("id", gram);
  }

  @Command("userinfo")
  async userinfo(gram: BaseContext) {
    await commandRegistry.run("userinfo", gram);
  }

  @Command("chatinfo")
  async chatinfo(gram: BaseContext) {
    await commandRegistry.run("chatinfo", gram);
  }

  @Command("botinfo")
  async botinfo(gram: BaseContext) {
    await commandRegistry.run("botinfo", gram);
  }

  @Command("define")
  async define(gram: BaseContext) {
    await commandRegistry.run("define", gram);
  }

  @Command("google")
  async google(gram: BaseContext) {
    await commandRegistry.run("google", gram);
  }

  @Command("wiki")
  async wiki(gram: BaseContext) {
    await commandRegistry.run("wiki", gram);
  }

  @Command("wakatime")
  async wakatime(gram: BaseContext) {
    await commandRegistry.run("wakatime", gram);
  }

  @CallbackQuery("cmd:*")
  async cmdCallbacks(gram: BaseContext) {
    const action = gram.match?.[0];
    if (!action) return;
    await gram.answer();

    if (action === "help") await sendRichText(gram, "Use /help to see all commands.");
    if (action === "status") await sendRichText(gram, "Use /status to see bot status.");
  }

  @CallbackQuery("gsel:*")
  async googlePick(gram: BaseContext) {
    await handleGooglePick(gram);
  }

  @CallbackQuery("gsec:*")
  async googleSection(gram: BaseContext) {
    await handleGoogleSection(gram);
  }

  @CallbackQuery("gqa:*")
  async googleQaPick(gram: BaseContext) {
    await handleGoogleQaPick(gram);
  }
}
