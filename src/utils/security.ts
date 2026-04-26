/**
 * Shared security guards for user-supplied inputs.
 */

const SUSPICIOUS_KEYWORDS = /\b(constructor|__proto__|prototype|process|require)\b/i;
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
