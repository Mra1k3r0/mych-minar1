/**
 * Shared security guards for user-supplied inputs.
 */

const SUSPICIOUS_KEYWORDS =
  /\b(constructor|__proto__|prototype|process|require|function|eval|return|this|toString|valueOf)\b/i;
const MAX_MATH_EXPR_LENGTH = 200;
const BLOCKED_CHARACTERS = /[[\]]/;

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

  if (BLOCKED_CHARACTERS.test(trimmed)) {
    return { ok: false, error: "Security block: property access via brackets is not allowed." };
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
  const SENSITIVE_KEYS = [
    "api_key",
    "apikey",
    "key",
    "token",
    "auth",
    "secret",
    "access_token",
    "session",
    "sid",
    "password",
    "pwd",
    "passwd",
  ];

  try {
    const u = new URL(url);

    // Mask basic auth
    if (u.username) u.username = "[redacted]";
    if (u.password) u.password = "[redacted]";

    // Mask sensitive query params
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        u.searchParams.set(key, "[redacted]");
      }
    }

    // Mask Telegram bot token in path (/bot<token>/...)
    if (u.pathname.includes("/bot")) {
      u.pathname = u.pathname.replace(/\/bot[^/]+/, "/bot[redacted]");
    }

    return u.toString();
  } catch {
    // Fallback if URL parsing fails (e.g. relative URLs)
    let out = url.replace(/^(?:\w+:)?\/\/([^/]+@)/, (match: string, authority: string) => {
      // authority is "user:pass@" or "user@"
      const parts = authority.split("@")[0].split(":");
      if (parts.length === 2) return "//[redacted]:[redacted]@";
      return "//[redacted]@";
    });

    for (const key of SENSITIVE_KEYS) {
      const regex = new RegExp(`([?&]${key}=)[^&]*`, "gi");
      out = out.replace(regex, "$1[redacted]");
    }
    return out.replace(/\/bot[^/?#\s]+/, "/bot[redacted]");
  }
}
