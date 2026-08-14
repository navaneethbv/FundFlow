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

// The local part is matched by exclusion, not by an allowlist: RFC-legal
// addresses contain characters like `'` and `!`, and a `[\w.%+-]+` local part
// leaves those prefixes behind ("o'brien@example.com" -> "o'[redacted]"),
// which still leaks PII into the admin inbox and the logs.
const EMAIL_PART_SEPARATORS = String.raw`<>()[]\:;,"@`;

function isEmailPartCharacter(value: string): boolean {
  return !EMAIL_PART_SEPARATORS.includes(value) && value.trim() !== "";
}

function isAsciiLetter(value: string): boolean {
  return (value >= "a" && value <= "z") || (value >= "A" && value <= "Z");
}

/**
 * End of the last `.tld` in the domain, where a TLD is two or more ASCII
 * letters, or -1 when there is none. The address has to end at the TLD rather
 * than wherever the token does: trailing punctuation is not part of the domain,
 * and stopping the whole scan on it ("user@example.com!") leaves the address in
 * the string unredacted.
 */
function domainEnd(token: string, domainStart: number, limit: number): number {
  let result = -1;
  // From domainStart + 1: a domain cannot begin with the dot ("user@.com").
  for (let index = domainStart + 1; index < limit; index += 1) {
    if (token[index] !== ".") continue;
    let afterTld = index + 1;
    while (afterTld < limit && isAsciiLetter(token[afterTld]!)) afterTld += 1;
    if (afterTld - index > 2) result = afterTld;
  }
  return result;
}

function findEmailSpan(token: string, searchFrom: number): { start: number; end: number } | null {
  while (searchFrom < token.length) {
    const at = token.indexOf("@", searchFrom);
    if (at < 0) return null;

    let start = at - 1;
    while (start >= 0 && isEmailPartCharacter(token[start]!)) start -= 1;
    let limit = at + 1;
    while (limit < token.length && isEmailPartCharacter(token[limit]!)) limit += 1;

    const end = domainEnd(token, at + 1, limit);
    if (start < at - 1 && end > 0) {
      return { start: start + 1, end };
    }
    searchFrom = at + 1;
  }
  return null;
}

function redactEmailToken(token: string): string {
  let output = "";
  let cursor = 0;
  let searchFrom = 0;
  let span = findEmailSpan(token, searchFrom);
  while (span) {
    output += token.slice(cursor, span.start) + "[redacted]";
    cursor = span.end;
    searchFrom = span.end;
    span = findEmailSpan(token, searchFrom);
  }

  return output + token.slice(cursor);
}

/** Alert summaries are documented as error messages only, never PII. */
export function redactEmails(text: string): string {
  return text.replace(/\S+/g, redactEmailToken);
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
