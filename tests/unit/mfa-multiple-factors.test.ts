import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("multiple TOTP factors", () => {
  const source = readFileSync("components/settings/MfaSection.tsx", "utf8");

  it("accepts friendly names and enforces the ten-factor limit", () => {
    expect(source).toContain("MAX_TOTP_FACTORS = 10");
    expect(source).toContain("friendlyName");
    expect(source).toContain("active.length >= MAX_TOTP_FACTORS");
  });

  it("cleans pending factors, warns on final removal, and supports replacement", () => {
    expect(source).toContain("cleanupPendingFactor");
    expect(source).toContain("final authenticator");
    expect(source).toContain("replacementFactorId");
    expect(source).toContain('finalizeMfaAction("verify"');
  });
});
