/**
 * Multi-tier sliding-window rate limiter designed for Groq free tier.
 * Tracks four independent budgets: RPM, RPD, TPM, TPD.
 * Each window slides — old entries expire naturally.
 */

interface WindowEntry {
  timestamp: number;
  tokens: number;
}

interface LimiterBudget {
  windowMs: number;
  maxRequests: number;
  maxTokens: number;
  entries: WindowEntry[];
  currentRequests: number;
  currentTokens: number;
}

export interface RateLimitStatus {
  minuteRequests: { used: number; max: number };
  dailyRequests: { used: number; max: number };
  minuteTokens: { used: number; max: number };
  dailyTokens: { used: number; max: number };
  canProceed: boolean;
  retryAfterMs: number;
  estimatedTokensAvailable: number;
}

export class GroqRateLimiter {
  private minute: LimiterBudget;
  private daily: LimiterBudget;

  constructor(opts: {
    requestsPerMinute: number;
    requestsPerDay: number;
    tokensPerMinute: number;
    tokensPerDay: number;
  }) {
    this.minute = {
      windowMs: 60_000,
      maxRequests: opts.requestsPerMinute,
      maxTokens: opts.tokensPerMinute,
      entries: [],
      currentRequests: 0,
      currentTokens: 0,
    };
    this.daily = {
      windowMs: 86_400_000,
      maxRequests: opts.requestsPerDay,
      maxTokens: opts.tokensPerDay,
      entries: [],
      currentRequests: 0,
      currentTokens: 0,
    };
  }

  /**
   * Performance optimization: use a while loop with shift() to prune expired entries
   * from the front of the sorted entries array and update running totals in O(K).
   */
  private prune(budget: LimiterBudget, now: number) {
    const cutoff = now - budget.windowMs;
    // Entries are naturally sorted by timestamp.
    while (budget.entries.length > 0 && budget.entries[0].timestamp <= cutoff) {
      const removed = budget.entries.shift();
      if (removed) {
        budget.currentRequests--;
        budget.currentTokens -= removed.tokens;
      }
    }
  }

  /**
   * Performance optimization: return pre-calculated running totals in O(1).
   */
  private sum(budget: LimiterBudget): { requests: number; tokens: number } {
    return { requests: budget.currentRequests, tokens: budget.currentTokens };
  }

  private retryAfter(budget: LimiterBudget, now: number): number {
    if (budget.entries.length === 0) return 0;
    const oldest = budget.entries[0];
    return Math.max(0, oldest.timestamp + budget.windowMs - now);
  }

  status(): RateLimitStatus {
    const now = Date.now();
    this.prune(this.minute, now);
    this.prune(this.daily, now);

    const min = this.sum(this.minute);
    const day = this.sum(this.daily);

    const minuteReqOk = min.requests < this.minute.maxRequests;
    const dailyReqOk = day.requests < this.daily.maxRequests;
    const minuteTokOk = min.tokens < this.minute.maxTokens;
    const dailyTokOk = day.tokens < this.daily.maxTokens;

    const canProceed = minuteReqOk && dailyReqOk && minuteTokOk && dailyTokOk;

    let retryAfterMs = 0;
    if (!minuteReqOk || !minuteTokOk) {
      retryAfterMs = Math.max(retryAfterMs, this.retryAfter(this.minute, now));
    }
    if (!dailyReqOk || !dailyTokOk) {
      retryAfterMs = Math.max(retryAfterMs, this.retryAfter(this.daily, now));
    }

    const estimatedTokensAvailable = Math.min(
      this.minute.maxTokens - min.tokens,
      this.daily.maxTokens - day.tokens,
    );

    return {
      minuteRequests: { used: min.requests, max: this.minute.maxRequests },
      dailyRequests: { used: day.requests, max: this.daily.maxRequests },
      minuteTokens: { used: min.tokens, max: this.minute.maxTokens },
      dailyTokens: { used: day.tokens, max: this.daily.maxTokens },
      canProceed,
      retryAfterMs,
      estimatedTokensAvailable: Math.max(0, estimatedTokensAvailable),
    };
  }

  acquire(): boolean {
    return this.status().canProceed;
  }

  record(tokens: number) {
    const entry: WindowEntry = { timestamp: Date.now(), tokens };
    this.minute.entries.push(entry);
    this.minute.currentRequests++;
    this.minute.currentTokens += tokens;

    this.daily.entries.push(entry);
    this.daily.currentRequests++;
    this.daily.currentTokens += tokens;
  }

  /** Conservative max_tokens to request, keeping headroom for response */
  suggestMaxTokens(inputEstimate: number): number {
    const s = this.status();
    const minuteBudget = Math.max(0, s.minuteTokens.max - s.minuteTokens.used - inputEstimate);
    const dailyBudget = Math.max(0, s.dailyTokens.max - s.dailyTokens.used - inputEstimate);
    const raw = Math.min(minuteBudget, dailyBudget);
    return Math.min(raw, 2048);
  }
}
