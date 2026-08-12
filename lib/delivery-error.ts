/**
 * Turns a delivery exception into the short code stored in
 * `weekly_report_deliveries.error_code` and echoed in the cron alert email.
 *
 * The provider's own message is kept, because collapsing every unrecognized
 * failure into "email_send_failed" made a sandbox-mode rejection look identical
 * to a network blip. Addresses are stripped first: this string reaches the
 * admin's inbox and the logs, and a bounce usually quotes the recipient.
 */

/** The error_code column is `char_length(error_code) between 1 and 80`. */
const ERROR_CODE_MAX = 80;

const EMAIL_PATTERN = /\b[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;

/** Alert summaries are documented as error messages only, never PII. */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[redacted]");
}

export function describeDeliveryError(error: unknown): string {
  if (!(error instanceof Error)) return "email_send_failed";

  // nodemailer puts the SMTP reply code on the error; it is the only signal
  // that distinguishes a provider rejection from a transport failure.
  const responseCode = (error as { responseCode?: unknown }).responseCode;
  if (typeof responseCode === "number") {
    const detail = redactEmails(
      error.message
        .replace(/^Message failed:\s*/i, "")
        .replace(new RegExp(String.raw`^${responseCode}\s*`), "")
        .trim(),
    );
    return `smtp_${responseCode}: ${detail}`.slice(0, ERROR_CODE_MAX);
  }

  if (error.message.includes("SMTP is not configured")) {
    return "smtp_not_configured";
  }
  if (/pdf|font/i.test(error.message)) return "pdf_render_failed";
  return "email_send_failed";
}

/**
 * RFC 5321: a 5xx reply is a permanent rejection and the message must not be
 * retried. 4xx is "try again later", and anything we could not attribute to the
 * provider (timeouts, our own config) stays retryable.
 */
export function isPermanentDeliveryError(code: string | null | undefined): boolean {
  return /^smtp_5\d\d\b/.test(code ?? "");
}

/** Stored on a delivery we declined to attempt, not one the provider refused. */
export const UNDELIVERABLE_RECIPIENT_CODE = "recipient_undeliverable";

/** RFC 2606 §2: reserved second-level domains. */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

/** RFC 2606 §2 and RFC 6761: reserved top-level domains. */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);

/**
 * True when the address is in a domain reserved by the RFCs above, which is
 * guaranteed never to accept mail. Sending to one wastes a provider attempt and
 * earns a 5xx that looks exactly like a real bank-report delivery failure.
 *
 * This is not hypothetical here: `tests/integration/` creates throwaway
 * `@example.com` users in the same Supabase project production runs against, so
 * while a test run is in flight those rows are visible to the weekly-report
 * cron and it would page the admin about a cron that is working correctly.
 *
 * Deliberately narrow. Anything it cannot parse is *not* declared
 * undeliverable — the provider is the better judge of a real address, and a
 * false positive here silently drops a user's report.
 */
export function isUndeliverableRecipient(
  email: string | null | undefined,
): boolean {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  const labels = domain.split(".");
  return (
    RESERVED_TLDS.has(labels.at(-1) ?? "") ||
    RESERVED_DOMAINS.has(labels.slice(-2).join("."))
  );
}
