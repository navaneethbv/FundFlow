import { describe, expect, it } from "vitest";
import { getPasskeyAvailability, passkeyErrorMessage } from "@/lib/passkeys";

describe("passkey availability", () => {
  it("allows secure localhost and the canonical production host", () => {
    expect(getPasskeyAvailability("localhost", true)).toEqual({ available: true, reason: null });
    expect(getPasskeyAvailability("fund-flow-swart.vercel.app", true)).toEqual({
      available: true,
      reason: null,
    });
  });

  it("blocks preview hosts, insecure contexts, unsupported browsers, and disabled projects", () => {
    expect(getPasskeyAvailability("fund-flow-git-test.vercel.app", true).available).toBe(false);
    expect(getPasskeyAvailability("fund-flow-swart.vercel.app", false).reason).toContain("secure");
    expect(getPasskeyAvailability("localhost", true, { browserSupported: false }).reason).toContain(
      "browser",
    );
    expect(getPasskeyAvailability("localhost", true, { projectEnabled: false }).reason).toContain(
      "not enabled",
    );
  });
});

describe("passkey errors", () => {
  it("maps browser cancellation and unsupported errors without exposing details", () => {
    expect(passkeyErrorMessage({ name: "NotAllowedError" })).toContain("cancelled");
    expect(passkeyErrorMessage({ name: "NotSupportedError" })).toContain("does not support");
    expect(passkeyErrorMessage({ code: "passkey_disabled" })).toContain("not enabled");
    expect(passkeyErrorMessage({ code: "too_many_passkeys" })).toContain("limit");
    expect(passkeyErrorMessage(new Error("credential-secret"))).not.toContain("credential-secret");
  });
});
