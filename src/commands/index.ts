// Heads up: importing each file auto-registers that command in the shared registry.

import "./core/start.js";
import "./core/help.js";
import "./core/ping.js";
import "./core/uptime.js";
import "./core/id.js";

import "./ai/ask.js";
import "./ai/chat.js";
import "./ai/agent.js";
import "./ai/clear.js";

import "./admin/stats.js";
import "./admin/status.js";

import "./fun/quote.js";
import "./fun/fact.js";
import "./fun/meme.js";
import "./fun/roll.js";
import "./fun/choose.js";
import "./fun/flip.js";
import "./fun/8ball.js";
import "./fun/rps.js";
import "./fun/cat.js";
import "./fun/dog.js";
import "./fun/neko.js";
import "./fun/hug.js";
import "./fun/kiss.js";
import "./fun/pat.js";
import "./fun/cuddle.js";
import "./fun/slap.js";
import "./fun/vtuber.js";
import "./fun/play.js";
import "./fun/video.js";

export { commandRegistry } from "./registry.js";
export type { CommandDef } from "./types.js";
