import { Controller, Command, CallbackQuery } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { commandRegistry } from "../commands/index.js";
import { runRpsRound } from "../services/fun/cmd.js";
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) return null;
  return value as UnknownRecord;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

@Controller()
export class FunController {
  private static readonly RPS_MOVES = ["rock", "paper", "scissors"] as const;

  @Command("quote")
  async quote(gram: BaseContext) {
    await commandRegistry.run("quote", gram);
  }

  @Command("fact")
  async fact(gram: BaseContext) {
    await commandRegistry.run("fact", gram);
  }

  @Command("randomcolor")
  async randomColor(gram: BaseContext) {
    await commandRegistry.run("randomcolor", gram);
  }

  @Command("meme")
  async meme(gram: BaseContext) {
    await commandRegistry.run("meme", gram);
  }

  @Command("cat")
  async cat(gram: BaseContext) {
    await commandRegistry.run("cat", gram);
  }

  @Command("dog")
  async dog(gram: BaseContext) {
    await commandRegistry.run("dog", gram);
  }

  @Command("neko")
  async neko(gram: BaseContext) {
    await commandRegistry.run("neko", gram);
  }

  @Command("hug")
  async hug(gram: BaseContext) {
    await commandRegistry.run("hug", gram);
  }

  @Command("kiss")
  async kiss(gram: BaseContext) {
    await commandRegistry.run("kiss", gram);
  }

  @Command("pat")
  async pat(gram: BaseContext) {
    await commandRegistry.run("pat", gram);
  }

  @Command("cuddle")
  async cuddle(gram: BaseContext) {
    await commandRegistry.run("cuddle", gram);
  }

  @Command("slap")
  async slap(gram: BaseContext) {
    await commandRegistry.run("slap", gram);
  }

  @Command("play")
  async play(gram: BaseContext) {
    await commandRegistry.run("play", gram);
  }

  @Command("video")
  async video(gram: BaseContext) {
    await commandRegistry.run("video", gram);
  }

  @Command("vtuber")
  async vtuber(gram: BaseContext) {
    await commandRegistry.run("vtuber", gram);
  }

  @CallbackQuery("vtb:*")
  async vtuberPick(gram: BaseContext) {
    await commandRegistry.run("vtuber", gram);
  }

  @Command("flip")
  async flip(gram: BaseContext) {
    await commandRegistry.run("flip", gram);
  }

  @Command("8ball")
  async eightBall(gram: BaseContext) {
    await commandRegistry.run("8ball", gram);
  }

  @Command("choose")
  async choose(gram: BaseContext) {
    await commandRegistry.run("choose", gram);
  }

  @Command("roll")
  async roll(gram: BaseContext) {
    await commandRegistry.run("roll", gram);
  }

  @Command("rps")
  async rps(gram: BaseContext) {
    await commandRegistry.run("rps", gram);
  }

  @CallbackQuery("rps:*")
  async rpsPick(gram: BaseContext) {
    const encoded = gram.match?.[0];
    if (
      !encoded ||
      !FunController.RPS_MOVES.includes(encoded as (typeof FunController.RPS_MOVES)[number])
    ) {
      await gram.answer("invalid move");
      return;
    }
    const user = encoded as (typeof FunController.RPS_MOVES)[number];
    const callbackQuery = asRecord((gram as unknown as Record<string, unknown>).callbackQuery);
    const callbackMessage = asRecord(callbackQuery?.message);
    const messageId = getNumber(callbackMessage?.message_id);
    await gram.answer("ok");
    await runRpsRound(gram, user, messageId);
  }
}
