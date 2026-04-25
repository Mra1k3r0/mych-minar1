type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;
const logStyle = (process.env.BOT_LOG_STYLE ?? "json").trim().toLowerCase();
const prettyLogs = logStyle === "pretty";
const color = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
} as const;
let commandBlockStarted = false;

function levelWeight(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 10;
    case "info":
      return 20;
    case "warn":
      return 30;
    case "error":
      return 40;
  }
}

function currentThreshold(): number {
  const raw = (process.env.BOT_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return levelWeight(raw);
  }
  return levelWeight("info");
}

function shouldLog(level: LogLevel): boolean {
  return levelWeight(level) >= currentThreshold();
}

function normalizeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
}

function normalizeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = normalizeError(v);
  }
  return out;
}

function stringifyField(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function fieldString(fields: LogFields | undefined, key: string): string | undefined {
  if (!fields) return undefined;
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

function fieldNumber(fields: LogFields | undefined, key: string): number | undefined {
  if (!fields) return undefined;
  const value = fields[key];
  return typeof value === "number" ? value : undefined;
}

function fieldBool(fields: LogFields | undefined, key: string): boolean | undefined {
  if (!fields) return undefined;
  const value = fields[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Pretty compact format for command execution logs.
 *
 * @param ts Local clock token (HH:MM:SS)
 * @param fields Structured command telemetry fields
 * @returns Human-first single-line CLI entry
 */
function compactCommandExecuted(ts: string, fields?: LogFields): string {
  const command = fieldString(fields, "command") ?? "unknown";
  const ok = fieldBool(fields, "ok");
  const latencyMs = fieldNumber(fields, "latencyMs");
  const chatId = fieldNumber(fields, "chatId");
  const status = ok === false ? `${color.red}fail${color.reset}` : `${color.cyan}ok${color.reset}`;
  const latency =
    typeof latencyMs === "number"
      ? latencyMs >= 1000
        ? `${(latencyMs / 1000).toFixed(2)}s`
        : `${String(latencyMs)}ms`
      : "-";
  const chat = typeof chatId === "number" ? String(chatId) : "-";
  return `${color.dim}${ts}${color.reset}  ${command.padEnd(10)} ${status} ${latency.padStart(7)}  chat:${chat}`;
}

/**
 * Pretty compact format for shutdown summary logs.
 *
 * @param ts Local clock token (HH:MM:SS)
 * @param fields Structured shutdown stats
 * @returns One-line shutdown summary for terminal output
 */
function compactShutdown(ts: string, fields?: LogFields): string {
  const signal = fieldString(fields, "signal") ?? "-";
  const calls = fieldNumber(fields, "totalCommandCalls");
  const failed = fieldNumber(fields, "totalCommandFailed");
  const topCommandsRaw: unknown = fields ? fields["topCommands"] : undefined;
  let top = "-";
  if (Array.isArray(topCommandsRaw) && topCommandsRaw.length > 0) {
    const first: unknown = topCommandsRaw[0];
    if (typeof first === "object" && first !== null) {
      const rec = first as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "unknown";
      const total = typeof rec.total === "number" ? rec.total : 0;
      top = `${name}(${String(total)})`;
    }
  }
  return `${color.dim}${ts}${color.reset}  shutdown ${signal}  calls:${String(calls ?? 0)} fail:${String(failed ?? 0)} top:${top}`;
}

function emitPretty(level: LogLevel, message: string, fields?: LogFields): void {
  const ts = new Date().toISOString().slice(11, 19);
  const levelLabel =
    level === "debug"
      ? `${color.dim}debug${color.reset}`
      : level === "info"
        ? `${color.cyan}info${color.reset}`
        : level === "warn"
          ? `${color.yellow}warn${color.reset}`
          : `${color.red}error${color.reset}`;
  const isCommandExecuted = message === "command.executed";
  const isShutdown = message === "bot.shutdown";
  const shouldHideStartup = message === "bot.starting";
  if (shouldHideStartup) return;

  let payload = `${color.dim}${ts}${color.reset} ${color.dim}·${color.reset} ${levelLabel} ${color.dim}·${color.reset} ${message}`;
  if (isCommandExecuted) {
    payload = compactCommandExecuted(ts, fields);
  } else if (isShutdown) {
    payload = compactShutdown(ts, fields);
  } else if (fields && Object.keys(fields).length > 0) {
    const rows = [payload];
    for (const [k, v] of Object.entries(fields)) {
      rows.push(`  ${color.dim}${k}:${color.reset} ${stringifyField(v)}`);
    }
    payload = rows.join("\n");
  }

  const lead = isShutdown || (isCommandExecuted && !commandBlockStarted) ? "\n" : "";
  commandBlockStarted = isCommandExecuted;
  if (level === "error") {
    console.error(`${lead}${payload}`);
    return;
  }
  if (level === "warn") {
    console.warn(`${lead}${payload}`);
    return;
  }
  console.log(`${lead}${payload}`);
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;
  if (prettyLogs) {
    emitPretty(level, message, normalizeFields(fields));
    return;
  }
  const row = {
    ts: new Date().toISOString(),
    level,
    message,
    ...normalizeFields(fields),
  };
  const payload = JSON.stringify(row);
  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    emit("debug", message, fields);
  },
  info(message: string, fields?: LogFields): void {
    emit("info", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit("warn", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit("error", message, fields);
  },
};
