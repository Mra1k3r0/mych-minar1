import type { BaseContext, MiddlewareFn } from "@mra1k3r0/gramora";
import { config } from "../config.js";
import { logger } from "../services/observability/logger.js";

type Transport = "polling" | "webhook";

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildRuntimeHooks() {
  return {
    onUpdateError: (
      _update: unknown,
      error: unknown,
      meta: { class: string; source: string; retryable: boolean; message: string },
    ) => {
      logger.error("gramora.update_error", {
        class: meta.class,
        source: meta.source,
        retryable: meta.retryable,
        message: meta.message,
        error: asErrorMessage(error),
      });
    },
    onPollingError: (
      error: unknown,
      retryDelayMs: number,
      meta: { class: string; source: string; retryable: boolean; message: string },
    ) => {
      logger.error("gramora.polling_error", {
        class: meta.class,
        source: meta.source,
        retryable: meta.retryable,
        retryDelayMs,
        message: meta.message,
        error: asErrorMessage(error),
      });
    },
    onRuntimeError: (
      meta: { class: string; source: string; retryable: boolean; message: string },
      error: unknown,
    ) => {
      logger.error("gramora.runtime_error", {
        class: meta.class,
        source: meta.source,
        retryable: meta.retryable,
        message: meta.message,
        error: asErrorMessage(error),
      });
    },
  };
}

export function buildRuntimeOperations() {
  const pollingRetryOn: Array<"rate_limit" | "network" | "api" | "unknown"> = [
    "rate_limit",
    "network",
    "api",
    "unknown",
  ];
  return {
    pollingRetryLogs: "structured" as const,
    pollingRetryBaseMs: 1000,
    pollingRetryMaxMs: 30000,
    pollingRetryOn,
  };
}

export function createErrorMiddleware(): MiddlewareFn<BaseContext> {
  return async (gram, next) => {
    try {
      await next();
    } catch (err) {
      logger.error("gramora.unhandled", {
        error: asErrorMessage(err),
        chatId: gram.chatId ?? null,
        fromId: gram.fromId ?? null,
      });
      try {
        await gram.send("⚠️ Something went wrong. Please try again.");
      } catch {
        // If reply fails too, we already logged the root error.
      }
    }
  };
}

/**
 * Resolves bot transport for launch.
 * Values come from `bot.config.jsonc` (`transport`, `webhook`) with `.env` overriding when set.
 *
 * @returns Polling launch options or webhook options with normalized fields.
 */
export function resolveLaunchOptions():
  | { transport: "polling" }
  | {
      transport: "webhook";
      webhook: {
        port: number;
        host?: string;
        path?: string;
        domain?: string;
        secretToken?: string;
        tunnel?: boolean;
        tunnelProvider?: "localtunnel" | "untun";
      };
    } {
  const transport: Transport = config.bot.transport === "webhook" ? "webhook" : "polling";
  if (transport === "polling") return { transport: "polling" };

  const w = config.bot.webhook ?? { port: 3000 };
  return {
    transport: "webhook",
    webhook: {
      port: w.port,
      ...(w.host !== undefined ? { host: w.host } : {}),
      ...(w.path !== undefined ? { path: w.path } : {}),
      ...(w.domain !== undefined ? { domain: w.domain } : {}),
      ...(w.secretToken !== undefined ? { secretToken: w.secretToken } : {}),
      ...(w.tunnel !== undefined ? { tunnel: w.tunnel } : {}),
      ...(w.tunnelProvider !== undefined ? { tunnelProvider: w.tunnelProvider } : {}),
    },
  };
}
