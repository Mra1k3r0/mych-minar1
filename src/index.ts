import { Gramora, rateLimiter } from "@mra1k3r0/gramora";
import { config } from "./config.js";
import { commandMetrics, conversations } from "./container.js";
import { CoreController } from "./controllers/core.controller.js";
import { AiController } from "./controllers/ai.controller.js";
import { AdminController } from "./controllers/admin.controller.js";
import { FunController } from "./controllers/fun.controller.js";
import { commandRegistry, loadCommandModules } from "./commands/index.js";
import { validateCommandIntentConsistency } from "./services/command/validate.js";
import { logger } from "./services/observability/logger.js";
import { createCommandMetricsMiddleware } from "./services/observability/middleware.js";
import {
  buildRuntimeHooks,
  buildRuntimeOperations,
  createErrorMiddleware,
  resolveLaunchOptions,
} from "./bootstrap/runtime.js";

const debugMode = (process.env.BOT_DEBUG ?? "false").trim().toLowerCase() === "true";
const logStyle = (process.env.BOT_LOG_STYLE ?? "pretty").trim().toLowerCase();
const prettyMode = logStyle === "pretty";
const spinnerFrames = ["◐", "◓", "◑", "◒"] as const;
const color = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
} as const;
const BOOT_COL_WIDTH = 14;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\u001b" && value[i + 1] === "[") {
      i += 2;
      while (i < value.length && !/[A-Za-z]/.test(value[i])) i++;
      continue;
    }
    out += value[i];
  }
  return out;
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function padAnsiRight(value: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(pad)}`;
}

/**
 * Prints the compact startup card shown in pretty mode.
 *
 * Keeps branding + runtime state in one place so the boot UI
 * stays consistent across future tweaks.
 */
function printPrettyBanner(): void {
  if (!prettyMode) return;
  const title = `${color.magenta}◉${color.reset} ${color.magenta}mych-minar1${color.reset} ${color.dim}tg runtime${color.reset}`;
  const modeToken = `${color.dim}◆${color.reset} pretty`;
  const debugToken = `${color.dim}◉${color.reset} ${String(debugMode)}`;
  const pidToken = `${color.dim}◌${color.reset} ${String(process.pid)}`;
  const meta = `${modeToken}  ${color.dim}·${color.reset}  ${debugToken}  ${color.dim}·${color.reset}  ${pidToken}`;
  const contentWidth = Math.max(52, visibleWidth(title), visibleWidth(meta)) + 2;
  const line = "─".repeat(contentWidth);
  const titleRow = padAnsiRight(title, contentWidth - 1);
  const metaRow = padAnsiRight(meta, contentWidth - 1);
  console.log(`${color.gray}╭${line}╮${color.reset}`);
  console.log(`${color.gray}│${color.reset} ${titleRow}${color.gray}│${color.reset}`);
  console.log(`${color.gray}│${color.reset} ${metaRow}${color.gray}│${color.reset}`);
  console.log(`${color.gray}╰${line}╯${color.reset}`);
  console.log("");
}

function printBootStep(name: string, detail: string): void {
  if (!prettyMode) return;
  console.log(`  ${color.dim}…${color.reset} ${name.padEnd(BOOT_COL_WIDTH)} ${detail}`);
}

function printBootSuccess(name: string, detail: string, elapsedMs?: number): void {
  if (!prettyMode) return;
  const took =
    typeof elapsedMs === "number" ? `${color.dim}${String(elapsedMs)}ms${color.reset}` : "";
  console.log(
    `  ${color.green}●${color.reset} ${name.padEnd(BOOT_COL_WIDTH)} ${detail}${took ? ` ${took}` : ""}`,
  );
}

function printBootFail(name: string, detail: string): void {
  if (!prettyMode) return;
  console.log(`  ${color.red}●${color.reset} ${name.padEnd(BOOT_COL_WIDTH)} ${detail}`);
}

function rewriteBootLine(line: string): void {
  process.stdout.write(`\r\x1b[2K${line}`);
}

async function runBootStep(
  name: string,
  detail: string,
  fn: () => void | Promise<void>,
  successDetail?: string,
): Promise<void> {
  if (!prettyMode || !process.stdout.isTTY) {
    printBootStep(name, detail);
    const started = Date.now();
    await fn();
    printBootSuccess(name, successDetail ?? "ready", Date.now() - started);
    return;
  }
  const started = Date.now();
  let frame = 0;
  rewriteBootLine(`  ${color.dim}…${color.reset} ${name.padEnd(BOOT_COL_WIDTH)} ${detail}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % spinnerFrames.length;
    const glyph = spinnerFrames[frame];
    rewriteBootLine(
      `  ${color.cyan}${glyph}${color.reset} ${name.padEnd(BOOT_COL_WIDTH)} ${detail}`,
    );
  }, 80);

  try {
    await fn();
    const elapsed = Date.now() - started;
    if (elapsed < 360) await sleep(360 - elapsed);
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
    printBootSuccess(name, successDetail ?? detail, elapsed);
  } catch (err) {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
    printBootFail(name, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Normalizes noisy framework console output into one visual style.
 *
 * @returns void
 */
function installPrettyConsoleBridge(): void {
  if (!prettyMode) return;
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const rewrite = (kind: "log" | "info" | "warn" | "error", args: unknown[]): void => {
    const text = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint")
          return String(arg);
        return "";
      })
      .join(" ")
      .trim();
    const match = /^\s*(info|warn|error)\s+(.+)$/i.exec(text);
    if (match) {
      const levelRaw = match[1].toLowerCase();
      const body = match[2];
      const level =
        levelRaw === "warn"
          ? `${color.yellow}warn${color.reset}`
          : levelRaw === "error"
            ? `${color.red}error${color.reset}`
            : `${color.cyan}info${color.reset}`;
      const ts = new Date().toISOString().slice(11, 19);
      const formatted = `${color.dim}${ts}${color.reset} ${color.dim}·${color.reset} ${level} ${color.dim}·${color.reset} ${body}`;
      if (kind === "warn") {
        originalWarn(formatted);
        return;
      }
      if (kind === "error") {
        originalError(formatted);
        return;
      }
      if (kind === "info") {
        originalInfo(formatted);
        return;
      }
      originalLog(formatted);
      return;
    }
    if (kind === "warn") {
      originalWarn(...args);
      return;
    }
    if (kind === "error") {
      originalError(...args);
      return;
    }
    if (kind === "info") {
      originalInfo(...args);
      return;
    }
    originalLog(...args);
  };

  console.log = (...args: unknown[]) => {
    rewrite("log", args);
  };
  console.info = (...args: unknown[]) => {
    rewrite("info", args);
  };
  console.warn = (...args: unknown[]) => {
    rewrite("warn", args);
  };
  console.error = (...args: unknown[]) => {
    rewrite("error", args);
  };
}

const bot = new Gramora({
  token: config.telegram.token,
  mode: "full",
  hooks: buildRuntimeHooks(),
  operations: buildRuntimeOperations(),
}).configure({ debug: debugMode, timeoutMs: 120000 });

const launchOptions = resolveLaunchOptions();
async function bootstrap(): Promise<void> {
  installPrettyConsoleBridge();
  printPrettyBanner();
  await runBootStep("commands", "loading command modules", async () => {
    await loadCommandModules();
  });
  const commandCount = commandRegistry.all().length;
  await runBootStep("middleware", "error + rate-limit + metrics", () => {
    bot.use(createErrorMiddleware());
    bot.use(rateLimiter(config.bot.telegramUserRpmLimit));
    bot.use(createCommandMetricsMiddleware(commandMetrics));
  });
  await runBootStep("controllers", "core, ai, admin, fun", () => {
    bot.register(CoreController);
    bot.register(AiController);
    bot.register(AdminController);
    bot.register(FunController);
  });
  await runBootStep(
    "intent",
    "validating intent metadata",
    () => {
      validateCommandIntentConsistency();
    },
    `${String(commandCount)} loaded`,
  );
  await runBootStep("transport", launchOptions.transport, () => undefined);
  if (prettyMode) console.log("");
  if (!prettyMode) {
    logger.info("bot.starting", {
      transport: launchOptions.transport,
      provider: config.llm.provider,
      model: config.llm.model,
      userRpmLimit: config.bot.telegramUserRpmLimit,
      loadedCommands: commandCount,
    });
  }
  const transportUpper = launchOptions.transport.toUpperCase();
  const startingLine = `${color.yellow}→${color.reset} ${color.dim}${transportUpper} starting... | ${config.llm.provider} | ${config.llm.model}${color.reset}`;
  const readyLine = `${color.yellow}→${color.reset} ${color.dim}${transportUpper} ready | ${config.llm.provider} | ${config.llm.model}${color.reset}`;
  const failedLine = `${color.red}→${color.reset} ${color.dim}${transportUpper} failed | ${config.llm.provider} | ${config.llm.model}${color.reset}`;

  const ttyPretty = prettyMode && process.stdout.isTTY;
  if (prettyMode) {
    console.log("");
    if (ttyPretty) {
      process.stdout.write(startingLine);
    } else {
      console.log(readyLine);
    }
  }

  const launchPromise = bot.launch(launchOptions);
  if (ttyPretty) {
    await sleep(280);
    rewriteBootLine(readyLine);
    process.stdout.write("\n");
  }

  launchPromise.catch((err: unknown) => {
    if (prettyMode) {
      console.log(failedLine);
    }
    logger.error("bot.startup_error", { error: err });
    process.exit(1);
  });
}

const shutdown = (signal: string) => {
  const summary = commandMetrics.snapshot();
  logger.info("bot.shutdown", {
    signal,
    totalCommandCalls: summary.totalCalls,
    totalCommandFailed: summary.totalFailed,
    topCommands: summary.commands.slice(0, 5).map((c) => ({
      name: c.name,
      total: c.total,
      failed: c.failed,
      avgLatencyMs: c.avgLatencyMs,
    })),
  });
  bot.stop();
  conversations.destroy();
  process.exit(0);
};
(["SIGINT", "SIGTERM"] as const).forEach((sig) => process.on(sig, () => shutdown(sig)));

void bootstrap().catch((err: unknown) => {
  logger.error("bot.bootstrap_error", { error: err });
  process.exit(1);
});
