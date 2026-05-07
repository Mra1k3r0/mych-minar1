import {
  TelegramApiError,
  buildWebhookUrl,
  normalizeWebhookOrigin,
  type Gramora,
  type Update,
} from "@mra1k3r0/gramora";
import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { Fetch, FetchM } from "../http/undici.js";
import { logger } from "../observability/logger.js";
import { startManagedTunnel, type ManagedTunnel, type TunnelProvider } from "../tunnel.js";

export type WebhookRuntimeConfig = {
  port: number;
  host?: string;
  path?: string;
  domain?: string;
  secretToken?: string;
  tunnel?: boolean;
  tunnelProvider?: TunnelProvider;
  tunnelOptions?: {
    localtunnel?: {
      host?: string;
      subdomain?: string;
      localHttps?: boolean;
    };
    cloudflared?: {
      binaryPath?: string;
    };
    ngrok?: {
      authtoken?: string;
      binaryPath?: string;
    };
    localexpose?: {
      authToken?: string;
      binaryPath?: string;
      region?: string;
      subdomain?: string;
      reservedDomain?: string;
    };
  };
};

export type WebhookServerRuntime = {
  close: () => Promise<void>;
};

type TelegramWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
};

const WEBHOOK_MAX_BODY_BYTES = 1_048_576;
const WEBHOOK_HEALTH_INTERVAL_MS = 45_000;
const WEBHOOK_KEEPALIVE_TIMEOUT_MS = 8_000;
const WEBHOOK_FAILURES_BEFORE_ROTATE = 3;
const TUNNEL_DNS_WARMUP_MS = 3_000;
const WEBHOOK_STARTUP_ROTATE_ATTEMPTS = 3;
const WEBHOOK_PUBLIC_DNS_WAIT_TIMEOUT_MS = 20_000;

const TUNNEL_FALLBACK_ORDER: TunnelProvider[] = ["localtunnel", "cloudflared", "ngrok"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tunnelProviderPriority(preferred?: TunnelProvider): TunnelProvider[] {
  if (!preferred) return [...TUNNEL_FALLBACK_ORDER];
  return [preferred, ...TUNNEL_FALLBACK_ORDER.filter((p) => p !== preferred)];
}

async function startManagedTunnelWithFallback(
  runtime: WebhookRuntimeConfig,
): Promise<ManagedTunnel> {
  const providers = tunnelProviderPriority(runtime.tunnelProvider);
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const tunnel = await startManagedTunnel({ ...runtime, tunnelProvider: provider });
      if (provider !== runtime.tunnelProvider) {
        logger.warn("telegram.webhook_tunnel_provider_fallback", {
          preferred: runtime.tunnelProvider ?? null,
          selected: provider,
        });
      }
      return tunnel;
    } catch (err) {
      lastError = err;
      logger.warn("telegram.webhook_tunnel_provider_failed", {
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw new Error(
    `Failed to start any tunnel provider (${providers.join(", ")}): ${String(lastError)}`,
  );
}

function headerSingle(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function isWebhookDnsRaceError(err: unknown): boolean {
  return (
    err instanceof TelegramApiError &&
    err.errorCode === 400 &&
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("failed to resolve host")
  );
}

function isBenignWebhookLastError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("wrong response from the webhook: 302 found");
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function hasPublicDnsRecord(hostname: string): Promise<boolean> {
  const endpoint = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`;
  try {
    const data = await Fetch<{ Answer?: unknown[]; Status?: number }>(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      mode: "strict",
      timeoutMs: 6_000,
    });
    if (data.Status !== 0) return false;
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return false;
  }
}

async function waitForPublicDns(hostname: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await hasPublicDnsRecord(hostname)) return true;
    await sleep(1_000);
  }
  return false;
}

async function registerTelegramWebhookWithRetries(
  setWebhook: () => Promise<unknown>,
  attempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await setWebhook();
      return;
    } catch (err) {
      if (attempt < attempts) {
        // Telegram can fail early on new trycloudflare hostnames before DNS propagates globally.
        const retryDelay = isWebhookDnsRaceError(err) ? 2_500 * attempt : 900 * attempt;
        await sleep(retryDelay);
        continue;
      }
      throw err;
    }
  }
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
    tunnel = await startManagedTunnelWithFallback(runtime);
    const rawTunnelUrl = await tunnel.getURL();
    publicHttpsOrigin = normalizeWebhookOrigin(rawTunnelUrl);
    logger.info("telegram.webhook_tunnel_started", {
      provider: tunnel.provider,
      domain: publicHttpsOrigin,
      port: runtime.port,
      rawTunnelUrl,
    });
  } else if (publicHttpsOrigin) {
    publicHttpsOrigin = normalizeWebhookOrigin(publicHttpsOrigin);
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
    let absoluteUrl = buildWebhookUrl(publicHttpsOrigin, adapter.path);
    const registerCurrentWebhook = async (attempts: number) => {
      if (usedTunnel) {
        // Give dynamic tunnel DNS a brief propagation window before setWebhook.
        await sleep(TUNNEL_DNS_WARMUP_MS);
      }
      if (usedTunnel) {
        const host = hostnameFromUrl(absoluteUrl);
        if (host) {
          const dnsReady = await waitForPublicDns(host, WEBHOOK_PUBLIC_DNS_WAIT_TIMEOUT_MS);
          if (!dnsReady) {
            logger.warn("telegram.webhook_dns_not_ready", {
              host,
              timeoutMs: WEBHOOK_PUBLIC_DNS_WAIT_TIMEOUT_MS,
            });
          }
        }
      }
      await registerTelegramWebhookWithRetries(() => {
        return bot.api.setWebhook({
          url: absoluteUrl,
          ...(runtime.secretToken !== undefined ? { secret_token: runtime.secretToken } : {}),
        });
      }, attempts);
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

      tunnel = await startManagedTunnelWithFallback(runtime);
      const rawTunnelUrl = await tunnel.getURL();
      publicHttpsOrigin = normalizeWebhookOrigin(rawTunnelUrl);
      absoluteUrl = buildWebhookUrl(publicHttpsOrigin, adapter.path);
      await registerCurrentWebhook(3);

      logger.warn("telegram.webhook_tunnel_rotated", {
        reason,
        provider: tunnel.provider,
        domain: publicHttpsOrigin,
        webhookUrl: absoluteUrl,
      });
    };

    const registerWithStartupRecovery = async () => {
      // For quick cloudflare tunnels, DNS can fail briefly on a fresh hostname.
      // If that keeps happening, rotate to a new tunnel URL and retry.
      for (let cycle = 1; cycle <= WEBHOOK_STARTUP_ROTATE_ATTEMPTS; cycle++) {
        try {
          await registerCurrentWebhook(usedTunnel ? 3 : 1);
          return;
        } catch (err) {
          if (
            !usedTunnel ||
            !isWebhookDnsRaceError(err) ||
            cycle >= WEBHOOK_STARTUP_ROTATE_ATTEMPTS
          ) {
            throw err;
          }
          logger.warn("telegram.webhook_startup_dns_retry", {
            cycle,
            error: err instanceof Error ? err.message : String(err),
            webhookUrl: absoluteUrl,
          });
          await rotateTunnelAndRebind(`startup dns resolve failure (cycle ${String(cycle)})`);
        }
      }
    };

    try {
      await registerWithStartupRecovery();
      telegramWebhookRegistered = true;
      const startWebhookHealthMonitor = () => {
        webhookHealthTimer = setInterval(() => {
          void (async () => {
            if (healthCheckRunning) return;
            healthCheckRunning = true;
            try {
              const info = (await bot.api.getWebhookInfo()) as TelegramWebhookInfo;
              const currentUrl = typeof info.url === "string" ? info.url : "";
              const pending = info.pending_update_count ?? 0;
              const lastErr = info.last_error_message;
              const benignLastErr = isBenignWebhookLastError(lastErr);
              const mismatch = currentUrl !== absoluteUrl;
              let healthProbeOk = true;
              if (publicHttpsOrigin) {
                const healthUrl = buildWebhookUrl(publicHttpsOrigin, "/healthz");
                try {
                  const res = await FetchM<unknown>(healthUrl, {
                    method: "GET",
                    headers: { accept: "application/json" },
                    mode: "strict",
                    allowNon2xx: true,
                    timeoutMs: WEBHOOK_KEEPALIVE_TIMEOUT_MS,
                  });
                  healthProbeOk = res.status >= 200 && res.status < 400;
                } catch {
                  healthProbeOk = false;
                }
              }

              if (
                mismatch ||
                (typeof lastErr === "string" && !benignLastErr) ||
                pending > 20 ||
                !healthProbeOk
              ) {
                logger.warn("telegram.webhook_health", {
                  expectedUrl: absoluteUrl,
                  registeredUrl: currentUrl || null,
                  pendingUpdateCount: pending,
                  lastErrorMessage: lastErr ?? null,
                  benignLastError: benignLastErr,
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

              const unhealthy =
                !healthProbeOk || mismatch || (typeof lastErr === "string" && !benignLastErr);
              if (unhealthy) {
                consecutiveHealthFailures++;
                const localexposeFastRotate =
                  tunnel?.provider === "localexpose" &&
                  !mismatch &&
                  (!healthProbeOk ||
                    pending > 0 ||
                    (typeof lastErr === "string" &&
                      /(connection reset by peer|connection refused|context deadline exceeded)/i.test(
                        lastErr,
                      )));
                const rotateThreshold = localexposeFastRotate ? 1 : WEBHOOK_FAILURES_BEFORE_ROTATE;
                if (consecutiveHealthFailures >= rotateThreshold) {
                  await rotateTunnelAndRebind(
                    `consecutive unhealthy checks: ${String(consecutiveHealthFailures)} (provider=${tunnel?.provider ?? "unknown"})`,
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
      const httpStatus = err instanceof TelegramApiError ? err.httpStatus : undefined;
      const responseBodySnippet =
        err instanceof TelegramApiError ? err.responseBodySnippet : undefined;
      logger.error("telegram.webhook_set_failed", {
        error: err instanceof Error ? err.message : String(err),
        telegramErrorCode: code,
        telegramMethod: method,
        telegramHttpStatus: httpStatus,
        telegramResponseSnippet: responseBodySnippet,
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
      publicHttpsOrigin !== undefined ? buildWebhookUrl(publicHttpsOrigin, adapter.path) : null,
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
