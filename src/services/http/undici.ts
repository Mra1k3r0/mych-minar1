import { fetch as undiciFetch } from "undici";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  mode?: "safe" | "strict";
};

export class HttpRequestError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly causeCode?: string;

  constructor(message: string, params: { url: string; status?: number; causeCode?: string }) {
    const fullMessage = `${message} [${params.url}${params.status ? ` - ${String(params.status)}` : ""}]`;
    super(fullMessage);
    this.name = "HttpRequestError";
    this.url = params.url;
    this.status = params.status;
    this.causeCode = params.causeCode;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

async function executeRequest(url: string, options: HttpRequestOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await undiciFetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpRequestError("Request timeout", { url, causeCode: "timeout" });
    }
    throw new HttpRequestError("Request failed", { url, causeCode: "network" });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonStrict<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const response = await executeRequest(url, options);
  if (!response.ok) {
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

async function fetchJsonSafe<T>(url: string, options: HttpRequestOptions = {}): Promise<T | null> {
  try {
    return await fetchJsonStrict<T>(url, options);
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
