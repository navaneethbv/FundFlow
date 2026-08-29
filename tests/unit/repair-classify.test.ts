import { describe, expect, it } from "vitest";
import { classifyRepairError } from "@/lib/repair";

describe("classifyRepairError", () => {
  it.each([
    [{ response: { data: { error_code: "PRODUCT_NOT_READY" } } }, "product_not_ready"],
    [{ response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } } }, "consent_required"],
    [{ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } }, "institution_login_required"],
    [{ response: { data: { error_code: "ITEM_ACCESS_NOT_GRANTED" } } }, "institution_login_required"],
    [{ response: { data: { error_code: "ITEM_ERROR" } } }, "institution_login_required"],
    [{ response: { data: { error_code: "RATE_LIMIT_EXCEEDED" } } }, "rate_limited"],
    [{ response: { data: { error_code: "RATE_LIMIT" } } }, "rate_limited"],
  ] as const)("classifies Plaid code %j as %s", (error, expected) => {
    expect(classifyRepairError(error)).toBe(expected);
  });

  it("reports generic_failure for an unknown provider code", () => {
    expect(
      classifyRepairError({ response: { data: { error_code: "UNEXPECTED" } } }),
    ).toBe("institution_login_required");
  });

  it("reports generic_failure when no Plaid error code exists", () => {
    expect(classifyRepairError(new Error("network down"))).toBe("generic_failure");
    expect(classifyRepairError({ response: { data: {} } })).toBe("generic_failure");
    expect(classifyRepairError(null)).toBe("generic_failure");
  });
});