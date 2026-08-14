import { describe, expect, it } from "vitest";
import {
  describeDeliveryError,
  isPermanentDeliveryError,
  isUndeliverableRecipient,
  redactEmails,
} from "@/lib/delivery-error";

function smtpError(responseCode: number, message: string) {
  return Object.assign(new Error(message), { responseCode });
}

describe("describeDeliveryError", () => {
  it("keeps the provider status code and message for a rejected send", () => {
    const error = smtpError(
      550,
      "Message failed: 550 Invalid `to` field. Please use our testing email address.",
    );
    expect(describeDeliveryError(error)).toBe(
      "smtp_550: Invalid `to` field. Please use our testing email address.",
    );
  });

  it("redacts email addresses out of the provider message", () => {
    const error = smtpError(
      550,
      "Message failed: 550 Only owner@gmail.com is allowed.",
    );
    expect(describeDeliveryError(error)).toBe(
      "smtp_550: Only [redacted] is allowed.",
    );
  });

  it("truncates to the 80 character error_code column limit", () => {
    const error = smtpError(451, `Message failed: 451 ${"x".repeat(200)}`);
    expect(describeDeliveryError(error)).toHaveLength(80);
  });

  it("maps a missing SMTP configuration to smtp_not_configured", () => {
    const error = new Error(
      "SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS); refusing to send financial email",
    );
    expect(describeDeliveryError(error)).toBe("smtp_not_configured");
  });

  it("maps a PDF rendering failure to pdf_render_failed", () => {
    expect(describeDeliveryError(new Error("font table missing"))).toBe(
      "pdf_render_failed",
    );
  });

  it("falls back to email_send_failed when nothing is recognizable", () => {
    expect(describeDeliveryError(new Error("socket hang up"))).toBe(
      "email_send_failed",
    );
    expect(describeDeliveryError("not an error at all")).toBe(
      "email_send_failed",
    );
  });
});

describe("redactEmails", () => {
  it("removes every address from a message bound for the alert inbox", () => {
    expect(redactEmails("relay refused a@b.com and c.d@e.co.uk")).toBe(
      "relay refused [redacted] and [redacted]",
    );
  });

  it("leaves a message with no address untouched", () => {
    expect(redactEmails("connection reset by peer")).toBe(
      "connection reset by peer",
    );
  });

  // A local part is not limited to [\w.%+-]; an allowlist pattern leaves the
  // leading characters behind, which still puts the address in the alert inbox.
  it("redacts the whole address when the local part has RFC-legal punctuation", () => {
    expect(redactEmails("bounced for o'brien@example.com")).toBe(
      "bounced for [redacted]",
    );
    expect(redactEmails("bounced for a!b#c$d@example.com")).toBe(
      "bounced for [redacted]",
    );
  });

  // The address ends at the TLD, not wherever the whitespace-delimited token
  // ends. Treating trailing punctuation as part of the domain fails the TLD
  // check and leaves the entire address in the alert inbox.
  it("redacts an address followed by punctuation", () => {
    expect(redactEmails("rejected: user@example.com!")).toBe(
      "rejected: [redacted]!",
    );
    expect(redactEmails("is user@example.com? unknown")).toBe(
      "is [redacted]? unknown",
    );
    expect(redactEmails("bounce for user@example.co.uk-1 today")).toBe(
      "bounce for [redacted]-1 today",
    );
    expect(redactEmails("relay refused <user@example.com>: no such user")).toBe(
      "relay refused <[redacted]>: no such user",
    );
  });

  it("leaves a bare @ token that is not an address alone", () => {
    expect(redactEmails("user@localhost refused")).toBe("user@localhost refused");
    expect(redactEmails("queued @ 12:00")).toBe("queued @ 12:00");
  });
});

describe("isPermanentDeliveryError", () => {
  it("treats a 5xx provider rejection as permanent", () => {
    expect(isPermanentDeliveryError("smtp_550: Invalid `to` field.")).toBe(true);
    expect(isPermanentDeliveryError("smtp_553: bad sender")).toBe(true);
  });

  it("treats a 4xx provider rejection as retryable", () => {
    expect(isPermanentDeliveryError("smtp_451: try again later")).toBe(false);
  });

  it("treats non-provider failures as retryable", () => {
    expect(isPermanentDeliveryError("email_send_failed")).toBe(false);
    expect(isPermanentDeliveryError("smtp_not_configured")).toBe(false);
    expect(isPermanentDeliveryError("pdf_render_failed")).toBe(false);
    expect(isPermanentDeliveryError(null)).toBe(false);
  });

});

describe("isUndeliverableRecipient", () => {
  it("rejects the RFC 2606 reserved second-level domains", () => {
    for (const domain of ["example.com", "example.net", "example.org"]) {
      expect(isUndeliverableRecipient(`rep-123@${domain}`)).toBe(true);
    }
  });

  it("rejects the RFC 2606 / RFC 6761 reserved top-level domains", () => {
    for (const tld of ["test", "invalid", "localhost", "example"]) {
      expect(isUndeliverableRecipient(`someone@fundflow.${tld}`)).toBe(true);
    }
  });

  it("rejects subdomains of a reserved domain", () => {
    expect(isUndeliverableRecipient("someone@mail.example.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isUndeliverableRecipient("  Rep-123@EXAMPLE.COM  ")).toBe(true);
  });

  it("accepts a real recipient domain", () => {
    for (const email of [
      "owner@gmail.com",
      "someone@fundflow.app",
      // Not reserved: only the bare label and its subdomains are.
      "someone@example.io",
      "someone@notexample.com",
      "someone@testing.com",
    ]) {
      expect(isUndeliverableRecipient(email)).toBe(false);
    }
  });

  it("does not claim to know about an unparseable address", () => {
    // The provider is a better judge than a regex; only reserved domains,
    // which can never accept mail, are decided here.
    for (const value of ["", "   ", "not-an-address", null, undefined]) {
      expect(isUndeliverableRecipient(value)).toBe(false);
    }
  });
});
