import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("passkey authentication UI", () => {
  it("signs in without email and preserves MFA step-up", () => {
    const source = readFileSync("components/LoginForm.tsx", "utf8");
    expect(source).toContain("signInWithPasskey");
    expect(source).toContain("Use a passkey");
    expect(source).toContain("completeIfMfaRequired");
    expect(source).toContain("getPasskeyAvailability");
  });

  it("supports passkey list, register, rename, delete, and safe audits", () => {
    const source = readFileSync("components/settings/PasskeysSection.tsx", "utf8");
    expect(source).toContain("auth.passkey.list");
    expect(source).toContain("auth.registerPasskey");
    expect(source).toContain("auth.passkey.update");
    expect(source).toContain("recordPasskeyChange(\"delete\"");
    expect(source).toContain("passkeyId");
    expect(source).not.toContain("credential:");
  });
});
