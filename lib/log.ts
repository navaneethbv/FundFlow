/**
 * Minimal safe logging. NEVER log Plaid tokens, account numbers, transaction
 * payloads, or PII. Log a short context string and the error message/stack only.
 */

const SENSITIVE_KEYS = [
  "access_token",
  "public_token",
  "token",
  "secret",
  "password",
  "account_number",
  "routing_number",
  "ssn",
  "authorization",
  "cookie",
];

/** Redact obviously-sensitive keys from an object before logging. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))
        ? "[redacted]"
        : redact(v);
    }
    return out;
  }
  return value;
}

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  // Message/stack only. No request bodies, no Plaid payloads.
  console.error(`[${context}] ${message}`, stack ? `\n${stack}` : "");
}
