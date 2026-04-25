import { config } from "../config.js";
import { GroqRateLimiter, type RateLimitStatus } from "./rate-limiter.js";
import { fetch as undiciFetch } from "undici";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers, fallbackMs: number): number {
  const raw = headers.get("retry-after");
  if (!raw) return fallbackMs;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 0) return Math.max(250, Math.floor(num * 1000));
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const ms = asDate - Date.now();
    return Math.max(250, ms);
  }
  return fallbackMs;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LlmStats {
  totalRequests: number;
  totalTokens: number;
  failedRequests: number;
  uptimeMs: number;
}

export interface LlmClient {
  chat(
    messages: ChatMessage[],
    opts?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<{ message: ChatMessage; usage: LlmUsage }>;
  rateLimitStatus(): RateLimitStatus;
  estimateTokens(messages: ChatMessage[]): number;
  get stats(): LlmStats;
}

// Keep tool schemas stable per session so provider caching stays happy.
const TOOL_SCHEMA_CACHE = new Map<string, ToolDefinition[]>();

function stableToolKey(tools: ToolDefinition[]): string {
  return tools
    .map(
      (t) =>
        `${t.function.name}:${t.function.description}:${JSON.stringify(t.function.parameters)}`,
    )
    .sort()
    .join("|");
}

function getCachedTools(tools: ToolDefinition[]): ToolDefinition[] {
  // Keep order deterministic so the same toolset hashes to the same cache key.
  const ordered = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name));
  const key = stableToolKey(ordered);
  const existing = TOOL_SCHEMA_CACHE.get(key);
  if (existing) return existing;
  TOOL_SCHEMA_CACHE.set(key, ordered);
  return ordered;
}

interface OpenAiCompatibleResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: ToolCall[] };
  }>;
  usage: LlmUsage;
}

function shouldRotateModel(status: number, errorBody: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (status === 408) return true;
  if (status === 400 || status === 404) {
    const lower = errorBody.toLowerCase();
    if (
      lower.includes("model") &&
      (lower.includes("not found") ||
        lower.includes("unsupported") ||
        lower.includes("does not exist") ||
        lower.includes("invalid"))
    ) {
      return true;
    }
  }
  return false;
}

class OpenAiCompatibleClient implements LlmClient {
  private limiter = new GroqRateLimiter(config.llm.limits);
  private totalRequests = 0;
  private totalTokens = 0;
  private failedRequests = 0;
  private startedAt = Date.now();
  private pacingChain: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  private isGroqLike(): boolean {
    return config.llm.baseUrl.toLowerCase().includes("groq.com");
  }

  // Queue requests with tiny spacing to avoid burst 429s.
  private async paceRequests(): Promise<void> {
    const minSpacingMs = this.isGroqLike() ? 550 : 150;
    let release = () => {};
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.pacingChain;
    this.pacingChain = previous.then(() => lock);
    await previous;
    try {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      this.nextRequestAt = Date.now() + minSpacingMs;
    } finally {
      release();
    }
  }

  get stats(): LlmStats {
    return {
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      failedRequests: this.failedRequests,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  rateLimitStatus(): RateLimitStatus {
    return this.limiter.status();
  }

  estimateTokens(messages: ChatMessage[]): number {
    const text = messages.map((m) => m.content).join("");
    return Math.ceil(text.length / 3.5) + messages.length * 4;
  }

  async chat(
    messages: ChatMessage[],
    opts?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<{ message: ChatMessage; usage: LlmUsage }> {
    if (!this.limiter.acquire()) {
      const status = this.limiter.status();
      const waitSec = Math.ceil(status.retryAfterMs / 1000);
      throw new RateLimitError(
        `Rate limit hit. Retry in ~${String(waitSec)}s`,
        status.retryAfterMs,
        status,
      );
    }

    const inputEstimate = this.estimateTokens(messages);
    const maxTokens = opts?.maxTokens ?? this.limiter.suggestMaxTokens(inputEstimate);

    const models = config.llm.models.length > 0 ? config.llm.models : [config.llm.model];
    const errors: string[] = [];
    let sawRateLimit = false;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: Math.max(maxTokens, 256),
        temperature: 0.7,
      };
      if (opts?.tools && opts.tools.length > 0) {
        body.tools = getCachedTools(opts.tools);
        body.tool_choice = "auto";
      }

      this.totalRequests++;
      try {
        await this.paceRequests();
        const response = await undiciFetch(`${config.llm.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.llm.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          this.failedRequests++;
          const errorBody = await response.text();
          errors.push(`[${model}] ${String(response.status)}: ${errorBody}`);
          if (response.status === 429) {
            sawRateLimit = true;
            const retryMs = parseRetryAfterMs(response.headers, 1800 + i * 600);
            await sleep(retryMs);
          }
          if (shouldRotateModel(response.status, errorBody)) continue;
          throw new LlmApiError(
            `LLM API ${String(response.status)}: ${errorBody}`,
            response.status,
          );
        }

        const data = (await response.json()) as OpenAiCompatibleResponse;
        const totalTokens = data.usage.total_tokens;
        this.totalTokens += totalTokens;
        this.limiter.record(totalTokens);

        const choice = data.choices.at(0);
        if (!choice) throw new LlmApiError("Empty response from LLM", 500);

        const msg: ChatMessage = { role: "assistant", content: choice.message.content ?? "" };
        if (choice.message.tool_calls) msg.tool_calls = choice.message.tool_calls;

        return { message: msg, usage: data.usage };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${model}] network/error: ${msg}`);
        if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted")) {
          await sleep(800 + i * 400);
          continue;
        }
        if (err instanceof LlmApiError) throw err;
        await sleep(500 + i * 250);
        continue;
      }
    }

    this.limiter.record(0);
    if (sawRateLimit) {
      throw new RateLimitError(
        `LLM API 429 across fallback models: ${errors.join(" | ")}`,
        60_000,
        this.limiter.status(),
      );
    }
    throw new LlmApiError(`All models failed: ${errors.join(" | ")}`, 502);
  }
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
}

class AnthropicClient implements LlmClient {
  private limiter = new GroqRateLimiter(config.llm.limits);
  private totalRequests = 0;
  private totalTokens = 0;
  private failedRequests = 0;
  private startedAt = Date.now();

  get stats(): LlmStats {
    return {
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      failedRequests: this.failedRequests,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  rateLimitStatus(): RateLimitStatus {
    return this.limiter.status();
  }

  estimateTokens(messages: ChatMessage[]): number {
    const text = messages.map((m) => m.content).join("");
    return Math.ceil(text.length / 3.5) + messages.length * 4;
  }

  async chat(
    messages: ChatMessage[],
    opts?: { tools?: ToolDefinition[]; maxTokens?: number },
  ): Promise<{ message: ChatMessage; usage: LlmUsage }> {
    if (!this.limiter.acquire()) {
      const status = this.limiter.status();
      const waitSec = Math.ceil(status.retryAfterMs / 1000);
      throw new RateLimitError(
        `Rate limit hit. Retry in ~${String(waitSec)}s`,
        status.retryAfterMs,
        status,
      );
    }

    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const nonSystem = messages.filter((m) => m.role !== "system");

    const anthropicMessages = nonSystem.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id ?? "tool_call",
              content: m.content,
            },
          ] satisfies AnthropicContentBlock[],
        };
      }
      return { role: m.role, content: m.content };
    });

    const inputEstimate = this.estimateTokens(messages);
    const maxTokens = opts?.maxTokens ?? this.limiter.suggestMaxTokens(inputEstimate);

    const tools = getCachedTools(opts?.tools ?? []).map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body: Record<string, unknown> = {
      model: config.llm.model,
      system,
      messages: anthropicMessages,
      max_tokens: Math.max(maxTokens, 256),
      temperature: 0.7,
      ...(tools.length > 0 ? { tools } : {}),
    };

    this.totalRequests++;
    const response = await undiciFetch(`${config.llm.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.llm.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      this.failedRequests++;
      const errorBody = await response.text();
      if (response.status === 429) {
        this.limiter.record(0);
        throw new RateLimitError(`Anthropic 429: ${errorBody}`, 60_000, this.limiter.status());
      }
      throw new LlmApiError(
        `Anthropic API ${String(response.status)}: ${errorBody}`,
        response.status,
      );
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const promptTokens = data.usage.input_tokens;
    const completionTokens = data.usage.output_tokens;
    const totalTokens = promptTokens + completionTokens;
    this.totalTokens += totalTokens;
    this.limiter.record(totalTokens);

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of data.content) {
      if (block.type === "text") textParts.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      }
    }

    const msg: ChatMessage = { role: "assistant", content: textParts.join("") };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;

    return {
      message: msg,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
  }
}

export function createLlmClient(): LlmClient {
  if (config.llm.provider === "anthropic") return new AnthropicClient();
  return new OpenAiCompatibleClient();
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number,
    public status: RateLimitStatus,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "LlmApiError";
  }
}
