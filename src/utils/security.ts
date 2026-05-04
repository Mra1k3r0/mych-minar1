/**
 * Shared security guards for user-supplied inputs.
 */

const SUSPICIOUS_KEYWORDS =
  /\b(constructor|__proto__|prototype|process|require|function|eval|return|this)\b/i;
const MAX_MATH_EXPR_LENGTH = 200;

export interface GuardResult {
  ok: boolean;
  error?: string;
}

/**
 * Validates a math expression for suspicious keywords and length limits.
 * Designed to protect expr-eval and similar parsers.
 */
export function guardMathExpression(expression: string): GuardResult {
  const trimmed = expression.trim();

  if (trimmed.length > MAX_MATH_EXPR_LENGTH) {
    return { ok: false, error: `Expression too long (max ${String(MAX_MATH_EXPR_LENGTH)} chars).` };
  }

  if (SUSPICIOUS_KEYWORDS.test(trimmed)) {
    return { ok: false, error: "Security block: suspicious keywords detected." };
  }

  return { ok: true };
}

/**
 * Masks sensitive information in URLs (API keys, bot tokens).
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);

    // Mask sensitive query params
    const SENSITIVE_KEYS = ["api_key", "apikey", "key", "token", "auth", "secret"];
    for (const key of u.searchParams.keys()) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        u.searchParams.set(key, "[redacted]");
      }
    }

    // Mask Telegram bot token in path (/bot<token>/...)
    if (u.pathname.startsWith("/bot")) {
      u.pathname = u.pathname.replace(/^\/bot[^/]+/, "/bot[redacted]");
    }

    return u.toString();
  } catch {
    // Fallback if URL parsing fails
    return url.replace(/api_key=[^&]+/gi, "api_key=[redacted]");
  }
}
