import { describe, expect, it } from "vitest";
import {
  describeDeliveryError,
  isPermanentDeliveryError,
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
