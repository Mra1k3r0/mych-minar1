import type { BaseContext, MiddlewareFn } from "@mra1k3r0/gramora";
import { logger } from "./logger.js";
import { CommandMetrics } from "./metrics.js";

function extractCommandName(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.trim().match(/^\/([a-z0-9_]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function createCommandMetricsMiddleware(metrics: CommandMetrics): MiddlewareFn<BaseContext> {
  return async (gram, next) => {
    const command = extractCommandName(gram.text);
    const started = Date.now();
    try {
      await next();
      if (!command) return;
      const latencyMs = Date.now() - started;
      metrics.record(command, latencyMs, true);
      logger.info("command.executed", {
        command,
        ok: true,
        latencyMs,
        chatId: gram.chatId ?? null,
        fromId: gram.fromId ?? null,
      });
    } catch (err) {
      if (command) {
        const latencyMs = Date.now() - started;
        metrics.record(command, latencyMs, false, err);
        logger.error("command.executed", {
          command,
          ok: false,
          latencyMs,
          chatId: gram.chatId ?? null,
          fromId: gram.fromId ?? null,
          error: err,
        });
      }
      throw err;
    }
  };
}
