import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const mockSendLoginAlertEmail = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockLogError = vi.fn<(...args: unknown[]) => void>();
const mockIsUndeliverable = vi.fn<(email: string) => boolean>(() => false);

vi.mock("@/lib/reporting", () => ({
  sendLoginAlertEmail: (...args: unknown[]) => mockSendLoginAlertEmail(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));
vi.mock("@/lib/delivery-error", () => ({
  isUndeliverableRecipient: (email: string) => mockIsUndeliverable(email),
}));

let serviceClient: ReturnType<typeof clientStub>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { notifyNewDeviceLogin, summarizeUserAgent } from "@/lib/login-alert";

describe("login-alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = clientStub();
    mockCheckRateLimit.mockResolvedValue(true);
    mockSendLoginAlertEmail.mockResolvedValue({});
    mockIsUndeliverable.mockReturnValue(false);
    mockLogError.mockReturnValue(undefined);
  });

  it("returns early without email or user agent or for an undeliverable recipient", async () => {
    await notifyNewDeviceLogin("u1", null, "UA");
    await notifyNewDeviceLogin("u1", "a@b.com", null);
    mockIsUndeliverable.mockReturnValue(true);
    await notifyNewDeviceLogin("u1", "a@example.com", "UA");
    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("skips when the device was seen before", async () => {
    serviceClient = clientStub({
      user_session_records: { data: null, count: 3 },
    });
    await notifyNewDeviceLogin("u1", "a@b.com", "UA");
    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("sends an alert when the device is new and the rate limit allows it", async () => {
    serviceClient = clientStub({
      user_session_records: { data: null, count: 0 },
    });
    await notifyNewDeviceLogin("u1", "a@b.com", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0");
    expect(mockCheckRateLimit).toHaveBeenCalledWith("login-alert:u1", 3, 24 * 3600);
    expect(mockSendLoginAlertEmail).toHaveBeenCalledWith("a@b.com", "Chrome on macOS");
  });

  it("skips when the rate limit is exhausted", async () => {
    serviceClient = clientStub({
      user_session_records: { data: null, count: 0 },
    });
    mockCheckRateLimit.mockResolvedValue(false);
    await notifyNewDeviceLogin("u1", "a@b.com", "UA");
    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("logs errors without rethrowing", async () => {
    serviceClient = clientStub({
      user_session_records: { data: null, count: 0 },
    });
    mockSendLoginAlertEmail.mockRejectedValue(new Error("smtp down"));
    await notifyNewDeviceLogin("u1", "a@b.com", "UA");
    expect(mockLogError).toHaveBeenCalledWith("login-alert", expect.anything());
  });

  it("summarizeUserAgent maps OS and browser patterns with fallbacks", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0")).toBe("Chrome on Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1")).toBe("Safari on macOS");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1")).toBe("Safari on iOS");
    expect(summarizeUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120.0")).toBe("Chrome on Android");
    expect(summarizeUserAgent("Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0")).toBe("Firefox on Linux");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) Edg/120.0")).toBe("Edge on Windows");
    expect(summarizeUserAgent("SomeBot")).toBe("Unknown browser on Unknown OS");
  });
});

describe("plaid-institution", () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function pngBase64(): string {
    return Buffer.from([...PNG_SIGNATURE, 0x00, 0x00, 0x00, 0x0d]).toString("base64");
  }

  it("validateInstitutionLogo accepts canonical PNG base64 and rejects non-canonical encodings", async () => {
    const { validateInstitutionLogo } = await import("@/lib/plaid-institution");
    const canonical = pngBase64();
    expect(validateInstitutionLogo(canonical)).toBe(canonical);
    expect(validateInstitutionLogo(`${canonical}=`)).toBeNull();
    expect(validateInstitutionLogo(null)).toBeNull();
    expect(validateInstitutionLogo(123)).toBeNull();
    expect(validateInstitutionLogo("not-base64!")).toBeNull();
    expect(validateInstitutionLogo(Buffer.from([0x00, 0x01, 0x02, 0x03]).toString("base64"))).toBeNull();
    expect(validateInstitutionLogo("A".repeat(600 * 1024))).toBeNull();
  });

  it("normalizeBrandColor lowercases valid hex and rejects others", async () => {
    const { normalizeBrandColor } = await import("@/lib/plaid-institution");
    expect(normalizeBrandColor("#0EA5A5")).toBe("#0ea5a5");
    expect(normalizeBrandColor("#fff")).toBeNull();
    expect(normalizeBrandColor(42)).toBeNull();
  });

  it("fetchInstitutionBranding maps branding and returns null on failure", async () => {
    const { fetchInstitutionBranding } = await import("@/lib/plaid-institution");
    const plaid = {
      institutionsGetById: vi.fn().mockResolvedValue({
        data: {
          institution: {
            name: "Chase",
            logo: pngBase64(),
            primary_color: "#0E5A9A",
          },
        },
      }),
    };
    const branding = await fetchInstitutionBranding(plaid as never, { institutionId: "i1", countryCodes: ["US"] as never });
    expect(branding).toEqual({ institutionId: "i1", name: "Chase", logo: pngBase64(), brandColor: "#0e5a9a" });

    plaid.institutionsGetById.mockRejectedValue(new Error("plaid down"));
    expect(await fetchInstitutionBranding(plaid as never, { institutionId: "i1", countryCodes: ["US"] as never })).toBeNull();
  });
});

describe("plaid", () => {
  it("falls back to the sandbox environment for an unknown PLAID_ENV", async () => {
    process.env.PLAID_CLIENT_ID = "test-id";
    process.env.PLAID_SECRET = "test-secret";
    process.env.PLAID_ENV = "not-a-real-environment";
    vi.resetModules();
    const { getPlaidClient } = await import("@/lib/plaid");
    expect(getPlaidClient()).toBeTruthy();
  });
});