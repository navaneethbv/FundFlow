import { describe, it, expect } from "vitest";
import { needsMfaStepUp } from "@/lib/mfa";

describe("needsMfaStepUp", () => {
  it("requires step-up for an aal1 session when aal2 is expected", () => {
    expect(needsMfaStepUp("aal1", "aal2")).toBe(true);
  });

  it("passes a fully verified aal2 session", () => {
    expect(needsMfaStepUp("aal2", "aal2")).toBe(false);
  });

  it("passes users with no MFA enrolled", () => {
    expect(needsMfaStepUp("aal1", "aal1")).toBe(false);
  });

  it("does not block when levels are unknown (no session)", () => {
    expect(needsMfaStepUp(null, null)).toBe(false);
    expect(needsMfaStepUp(undefined, undefined)).toBe(false);
  });

  it("requires step-up when current level is missing but aal2 is expected", () => {
    expect(needsMfaStepUp(null, "aal2")).toBe(true);
  });
});
