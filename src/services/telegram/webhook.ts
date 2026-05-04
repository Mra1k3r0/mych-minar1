import { TelegramApiError, type Gramora, type Update } from "@mra1k3r0/gramora";
import localtunnel from "localtunnel";
import { startTunnel } from "untun";
import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { Fetch, HttpRequestError } from "../http/undici.js";
import { logger } from "../observability/logger.js";
import { config } from "../../config.js";

export type WebhookRuntimeConfig = {
  port: number;
  host?: string;
  path?: string;
  domain?: string;
  secretToken?: string;
  tunnel?: boolean;
  tunnelProvider?: "localtunnel" | "untun";
};

export type WebhookServerRuntime = {
  close: () => Promise<void>;
};

type ManagedTunnel = {
  provider: "localtunnel" | "untun";
  getURL: () => Promise<string>;
  close: () => Promise<void>;
};

type TelegramWebhookInfo = {
  ok?: boolean;
  result?: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    ip_address?: string;
  };
  description?: string;
};

const WEBHOOK_MAX_BODY_BYTES = 1_048_576;
const WEBHOOK_HEALTH_INTERVAL_MS = 45_000;
const WEBHOOK_KEEPALIVE_TIMEOUT_MS = 8_000;
const WEBHOOK_FAILURES_BEFORE_ROTATE = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerSingle(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Clean tunnel/domain text so Telegram gets a valid https origin. */
function normalizePublicWebhookOrigin(raw: string): string {
  let s = raw
    .trim()
    .replace(/^['"`<(]+/, "")
    .trim();
  s = s.replace(/[`"'>)]+$/, "").trim();
  if (s.startsWith("http://")) {
    s = `https://${s.slice("http://".length)}`;
  }
  const withScheme = s.startsWith("https://") ? s : `https://${s}`;
  return withScheme.endsWith("/") ? withScheme.slice(0, -1) : withScheme;
}

function webhookAbsoluteUrl(publicOrigin: string, mountPath: string): string {
  const base = normalizePublicWebhookOrigin(publicOrigin);
  const p = mountPath.startsWith("/") ? mountPath : `/${mountPath}`;
  return `${base}${p}`;
}

/** Register webhook and keep Telegram's real error description on failures. */
async function registerTelegramWebhook(opts: {
  token: string;
  url: string;
  secretToken?: string;
}): Promise<void> {
  const endpoint = `https://api.telegram.org/bot${opts.token}/setWebhook`;
  let parsed: Record<string, unknown>;
  try {
    parsed = await Fetch<Record<string, unknown>>(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        url: opts.url,
        ...(opts.secretToken !== undefined ? { secret_token: opts.secretToken } : {}),
      }),
      mode: "strict",
      timeoutMs: 12_000,
    });
  } catch (err) {
    if (err instanceof HttpRequestError) {
      throw new TelegramApiError(
        `setWebhook request failed: ${err.message}`,
        err.status ?? 500,
        "setWebhook",
      );
    }
    throw err;
  }

  if (parsed.ok !== true) {
    const desc =
      typeof parsed.description === "string"
        ? parsed.description
        : "Telegram API rejected setWebhook";
    throw new TelegramApiError(
      desc,
      typeof parsed.error_code === "number" ? parsed.error_code : 400,
      "setWebhook",
    );
  }
}

async function fetchTelegramWebhookInfo(token: string): Promise<TelegramWebhookInfo> {
  const endpoint = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const parsed = await Fetch<TelegramWebhookInfo>(endpoint, {
    method: "GET",
    headers: { accept: "application/json" },
    mode: "strict",
    timeoutMs: 12_000,
  });
  return parsed;
}

async function registerTelegramWebhookWithRetries(
  opts: Parameters<typeof registerTelegramWebhook>[0],
  attempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await registerTelegramWebhook(opts);
      return;
    } catch (err) {
      if (attempt < attempts) {
        await sleep(900 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function startManagedTunnel(runtime: WebhookRuntimeConfig): Promise<ManagedTunnel> {
  const provider = runtime.tunnelProvider ?? "localtunnel";
  if (provider === "localtunnel") {
    const t = await localtunnel({ port: runtime.port });
    return {
      provider: "localtunnel",
      getURL: () => Promise.resolve(t.url),
      close: () => {
        t.close();
        return Promise.resolve();
      },
    };
  }

  const untunAccept =
    typeof process.env.UNTUN_ACCEPT_CLOUDFLARE_NOTICE === "string" &&
    ["1", "true", "yes", "on"].includes(
      process.env.UNTUN_ACCEPT_CLOUDFLARE_NOTICE.trim().toLowerCase(),
    );
  const t = await startTunnel({ port: runtime.port, acceptCloudflareNotice: untunAccept });
  if (!t) {
    throw new Error("Failed to create webhook tunnel (untun returned undefined).");
  }
  return {
    provider: "untun",
    getURL: t.getURL,
    close: t.close,
  };
}

/** Constant-time secret comparison. */
function timingSafeSecretEqual(incoming: string, expected: string): boolean {
  const hashA = createHash("sha256").update(incoming).digest();
  const hashB = createHash("sha256").update(expected).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Start Fastify webhook server, optionally tunnel it, then register Telegram webhook. */
export async function startFastifyWebhookServer(
  bot: Gramora,
  runtime: WebhookRuntimeConfig,
): Promise<WebhookServerRuntime> {
  const server = Fastify({ logger: false });
  let tunnel: ManagedTunnel | undefined;
  let usedTunnel = false;
  /** Public origin Telegram will call. */
  let publicHttpsOrigin =
    typeof runtime.domain === "string" && runtime.domain.trim().length > 0
      ? runtime.domain.trim()
      : undefined;

  if (!publicHttpsOrigin && runtime.tunnel) {
    usedTunnel = true;
    tunnel = await startManagedTunnel(runtime);
    const rawTunnelUrl = await tunnel.getURL();
    publicHttpsOrigin = normalizePublicWebhookOrigin(rawTunnelUrl);
    logger.info("telegram.webhook_tunnel_started", {
      provider: tunnel.provider,
      domain: publicHttpsOrigin,
      port: runtime.port,
      rawTunnelUrl,
    });
  } else if (publicHttpsOrigin) {
    publicHttpsOrigin = normalizePublicWebhookOrigin(publicHttpsOrigin);
  }

  /** We call setWebhook ourselves for clearer errors. */
  const adapter = await bot.createWebhook({
    path: runtime.path,
    secretToken: runtime.secretToken,
  });

  server.get("/healthz", () => ({ ok: true }));

  server.post(adapter.path, { bodyLimit: WEBHOOK_MAX_BODY_BYTES }, async (request, reply) => {
    const secret = runtime.secretToken;
    if (secret) {
      const incoming = headerSingle(request.headers["x-telegram-bot-api-secret-token"]);
      if (typeof incoming !== "string" || !timingSafeSecretEqual(incoming, secret)) {
        return reply.code(401).send("unauthorized");
      }
    }

    const ctype = headerSingle(request.headers["content-type"]) ?? "";
    if (!ctype.toLowerCase().includes("application/json")) {
      return reply.code(415).send("unsupported media type");
    }

    const update = request.body as Update;
    void bot.handleUpdate(update);
    return reply.code(200).send("ok");
  });

  const listenHost = runtime.host?.trim() || "0.0.0.0";
  await server.listen({
    host: listenHost,
    port: runtime.port,
  });

  let telegramWebhookRegistered = false;
  let webhookHealthTimer: NodeJS.Timeout | undefined;
  let healthCheckRunning = false;
  let consecutiveHealthFailures = 0;

  if (publicHttpsOrigin) {
    let absoluteUrl = webhookAbsoluteUrl(publicHttpsOrigin, adapter.path);
    const registerCurrentWebhook = async (attempts: number) => {
      await registerTelegramWebhookWithRetries(
        {
          token: config.telegram.token,
          url: absoluteUrl,
          secretToken: runtime.secretToken,
        },
        attempts,
      );
    };

    const rotateTunnelAndRebind = async (reason: string) => {
      if (!usedTunnel) return;
      try {
        await tunnel?.close();
      } catch (closeErr) {
        logger.warn("telegram.webhook_tunnel_close_failed", {
          error: closeErr instanceof Error ? closeErr.message : String(closeErr),
        });
      }

      tunnel = await startManagedTunnel(runtime);
      const rawTunnelUrl = await tunnel.getURL();
      publicHttpsOrigin = normalizePublicWebhookOrigin(rawTunnelUrl);
      absoluteUrl = webhookAbsoluteUrl(publicHttpsOrigin, adapter.path);
      await registerCurrentWebhook(3);

      logger.warn("telegram.webhook_tunnel_rotated", {
        reason,
        provider: tunnel.provider,
        domain: publicHttpsOrigin,
        webhookUrl: absoluteUrl,
      });
    };

    try {
      await registerCurrentWebhook(usedTunnel ? 3 : 1);
      telegramWebhookRegistered = true;
      const startWebhookHealthMonitor = () => {
        webhookHealthTimer = setInterval(() => {
          void (async () => {
            if (healthCheckRunning) return;
            healthCheckRunning = true;
            try {
              const info = await fetchTelegramWebhookInfo(config.telegram.token);
              const currentUrl = typeof info.result?.url === "string" ? info.result.url : "";
              const pending = info.result?.pending_update_count ?? 0;
              const lastErr = info.result?.last_error_message;
              const mismatch = currentUrl !== absoluteUrl;
              let healthProbeOk = true;
              if (publicHttpsOrigin) {
                const healthUrl = webhookAbsoluteUrl(publicHttpsOrigin, "/healthz");
                try {
                  await Fetch<{ ok?: boolean }>(healthUrl, {
                    method: "GET",
                    headers: { accept: "application/json" },
                    mode: "strict",
                    timeoutMs: WEBHOOK_KEEPALIVE_TIMEOUT_MS,
                  });
                } catch {
                  healthProbeOk = false;
                }
              }

              if (mismatch || typeof lastErr === "string" || pending > 20 || !healthProbeOk) {
                logger.warn("telegram.webhook_health", {
                  expectedUrl: absoluteUrl,
                  registeredUrl: currentUrl || null,
                  pendingUpdateCount: pending,
                  lastErrorMessage: lastErr ?? null,
                  mismatch,
                  healthProbeOk,
                });
              }

              if (mismatch) {
                try {
                  await registerCurrentWebhook(2);
                  logger.info("telegram.webhook_repaired", {
                    webhookUrl: absoluteUrl,
                  });
                } catch (repairErr) {
                  logger.warn("telegram.webhook_repair_failed", {
                    error: repairErr instanceof Error ? repairErr.message : String(repairErr),
                    webhookUrl: absoluteUrl,
                  });
                }
              }

              const unhealthy = !healthProbeOk || mismatch || typeof lastErr === "string";
              if (unhealthy) {
                consecutiveHealthFailures++;
                if (consecutiveHealthFailures >= WEBHOOK_FAILURES_BEFORE_ROTATE) {
                  await rotateTunnelAndRebind(
                    `consecutive unhealthy checks: ${String(consecutiveHealthFailures)}`,
                  );
                  consecutiveHealthFailures = 0;
                }
              } else {
                consecutiveHealthFailures = 0;
              }
            } catch (healthErr) {
              logger.warn("telegram.webhook_health_failed", {
                error: healthErr instanceof Error ? healthErr.message : String(healthErr),
              });
              consecutiveHealthFailures++;
              if (consecutiveHealthFailures >= WEBHOOK_FAILURES_BEFORE_ROTATE) {
                try {
                  await rotateTunnelAndRebind("health monitor exception");
                  consecutiveHealthFailures = 0;
                } catch (rotateErr) {
                  logger.warn("telegram.webhook_rotate_failed", {
                    error: rotateErr instanceof Error ? rotateErr.message : String(rotateErr),
                  });
                }
              }
            } finally {
              healthCheckRunning = false;
            }
          })();
        }, WEBHOOK_HEALTH_INTERVAL_MS);
        webhookHealthTimer.unref();
      };
      startWebhookHealthMonitor();
    } catch (err) {
      const code = err instanceof TelegramApiError ? err.errorCode : undefined;
      const method = err instanceof TelegramApiError ? err.method : undefined;
      logger.error("telegram.webhook_set_failed", {
        error: err instanceof Error ? err.message : String(err),
        telegramErrorCode: code,
        telegramMethod: method,
        webhookUrl: absoluteUrl,
      });
      throw err;
    }
  } else {
    logger.warn("telegram.webhook_url_not_set", {
      message:
        "Webhook server is listening but Gramora did not call setWebhook (no public domain). Telegram will not POST updates until you set bot.webhook.domain or WEBHOOK_DOMAIN to your HTTPS URL, or call setWebhook manually.",
      listen: `http://${listenHost}:${String(runtime.port)}`,
      path: adapter.path,
    });
  }

  logger.info("telegram.webhook_ready", {
    port: runtime.port,
    host: listenHost,
    path: adapter.path,
    health: "/healthz",
    domain: publicHttpsOrigin ?? null,
    webhookUrl:
      publicHttpsOrigin !== undefined ? webhookAbsoluteUrl(publicHttpsOrigin, adapter.path) : null,
    tunnelEnabled: Boolean(runtime.tunnel),
    tunnelActive: usedTunnel,
    telegramUrlRegistered: telegramWebhookRegistered,
  });

  return {
    close: async () => {
      if (webhookHealthTimer) {
        clearInterval(webhookHealthTimer);
      }
      await server.close();
      if (tunnel) {
        await tunnel.close();
      }
    },
  };
}
