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

const EMAIL_PATTERN = /[^\s<>()[\]:;,"]+@[^\s<>()[\]:;,"]+\.[a-z]{2,}/gi;

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
        .replace(new RegExp(`^${responseCode}\\s*`), "")
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
