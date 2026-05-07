import { Agent, fetch as undiciFetch } from "undici";
import { sanitizeUrl } from "../../utils/security.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  ipFamily?: 4 | 6;
  mode?: "safe" | "strict";
  allowNon2xx?: boolean;
};

export type HttpRes<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};

export class HttpRequestError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly causeCode?: string;

  constructor(message: string, params: { url: string; status?: number; causeCode?: string }) {
    const safeUrl = sanitizeUrl(params.url);
    const fullMessage = `${message} [${safeUrl}${params.status ? ` - ${String(params.status)}` : ""}]`;
    super(fullMessage);
    this.name = "HttpRequestError";
    this.url = safeUrl;
    this.status = params.status;
    this.causeCode = params.causeCode;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 30_000;
const dispatcherByFamily: Partial<Record<4 | 6, Agent>> = {};
const defaultDispatcher = new Agent({
  connect: {
    timeout: CONNECT_TIMEOUT_MS,
    autoSelectFamily: true,
  },
});

function dispatcherForFamily(ipFamily?: 4 | 6): Agent | undefined {
  if (!ipFamily) return defaultDispatcher;
  const existing = dispatcherByFamily[ipFamily];
  if (existing) return existing;
  const created = new Agent({
    connect: {
      family: ipFamily,
      timeout: CONNECT_TIMEOUT_MS,
    },
  });
  dispatcherByFamily[ipFamily] = created;
  return created;
}

async function executeRequest(url: string, options: HttpRequestOptions = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;
  try {
    return await undiciFetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      dispatcher: dispatcherForFamily(options.ipFamily),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpRequestError("Request timeout", { url, causeCode: "timeout" });
    }
    throw new HttpRequestError("Request failed", { url, causeCode: "network" });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchJsonStrict<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const response = await executeRequest(url, options);
  if (!response.ok && !options.allowNon2xx) {
    throw new HttpRequestError("Non-2xx HTTP response", {
      url,
      status: response.status,
      causeCode: "http",
    });
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpRequestError("Invalid JSON response", {
      url,
      status: response.status,
      causeCode: "invalid_json",
    });
  }
}

export async function FetchM<T>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpRes<T>> {
  const response = await executeRequest(url, options);
  if (!response.ok && !options.allowNon2xx) {
    throw new HttpRequestError("Non-2xx HTTP response", {
      url,
      status: response.status,
      causeCode: "http",
    });
  }
  try {
    return {
      ok: response.ok,
      status: response.status,
      data: (await response.json()) as T,
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
    };
  }
}

async function fetchJsonSafe<T>(url: string, options: HttpRequestOptions = {}): Promise<T | null> {
  try {
    return await fetchJsonStrict<T>(url, options);
  } catch {
    return null;
  }
}

async function fetchBytesStrict(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Uint8Array> {
  const response = await executeRequest(url, options);
  if (!response.ok && !options.allowNon2xx) {
    throw new HttpRequestError("Non-2xx HTTP response", {
      url,
      status: response.status,
      causeCode: "http",
    });
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new HttpRequestError("Invalid binary response", {
      url,
      status: response.status,
      causeCode: "invalid_body",
    });
  }
}

async function fetchBytesSafe(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Uint8Array | null> {
  try {
    return await fetchBytesStrict(url, options);
  } catch {
    return null;
  }
}

export function Fetch<T>(
  url: string,
  options?: HttpRequestOptions & { mode?: "safe" },
): Promise<T | null>;
export function Fetch<T>(url: string, options: HttpRequestOptions & { mode: "strict" }): Promise<T>;
export async function Fetch<T>(url: string, options: HttpRequestOptions = {}): Promise<T | null> {
  if (options.mode === "strict") {
    return fetchJsonStrict<T>(url, options);
  }
  return fetchJsonSafe<T>(url, options);
}

export function FetchBytes(
  url: string,
  options?: HttpRequestOptions & { mode?: "safe" },
): Promise<Uint8Array | null>;
export function FetchBytes(
  url: string,
  options: HttpRequestOptions & { mode: "strict" },
): Promise<Uint8Array>;
export async function FetchBytes(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Uint8Array | null> {
  if (options.mode === "strict") {
    return fetchBytesStrict(url, options);
  }
  return fetchBytesSafe(url, options);
}
