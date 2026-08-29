import { describe, expect, it } from "vitest";
import { classifyRepairError, repairResponseToUiState } from "@/lib/repair";

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
describe("repairResponseToUiState", () => {
  it("maps a completed repair to a success state without retry", () => {
    const state = repairResponseToUiState({
      ok: true,
      status: "repaired",
      pagesCompleted: 2,
      maxPages: 8,
      completed: true,
      added: 4,
      modified: 1,
      removed: 0,
    });
    expect(state.kind).toBe("success");
    expect(state.retry).toBe(false);
    expect(state.reconnect).toBe(false);
    expect(state.message).toContain("4 added");
  });

  it("maps a bounded backfill to a retry state that explains progress", () => {
    const state = repairResponseToUiState({
      ok: true,
      status: "backfill_incomplete",
      pagesCompleted: 5,
      maxPages: 8,
      completed: false,
      added: 40,
      modified: 0,
      removed: 0,
    });
    expect(state.kind).toBe("backfill_incomplete");
    expect(state.retry).toBe(true);
    expect(state.message).toContain("5 of 8");
  });

  it("maps product_not_ready to a retriable info state", () => {
    const state = repairResponseToUiState({
      ok: false,
      status: "product_not_ready",
      message: "Not ready yet.",
    });
    expect(state.kind).toBe("info");
    expect(state.retry).toBe(true);
    expect(state.reconnect).toBe(false);
  });

  it("maps consent_required to a reconnect state", () => {
    const state = repairResponseToUiState({
      ok: false,
      status: "consent_required",
      message: "New consent needed.",
    });
    expect(state.kind).toBe("needs_consent");
    expect(state.reconnect).toBe(true);
  });

  it("maps institution_login_required to a reconnect state", () => {
    const state = repairResponseToUiState({
      ok: false,
      status: "institution_login_required",
      message: "Log in again.",
    });
    expect(state.kind).toBe("needs_login");
    expect(state.reconnect).toBe(true);
  });

  it("maps rate_limited to a retry state", () => {
    const state = repairResponseToUiState({
      ok: false,
      status: "rate_limited",
      message: "Retry later.",
    });
    expect(state.kind).toBe("rate_limited");
    expect(state.retry).toBe(true);
  });

  it("maps generic failure and network errors to a retryable error state", () => {
    expect(repairResponseToUiState({ ok: false, status: "generic_failure", message: "X" }).kind).toBe("error");
    expect(repairResponseToUiState(null).kind).toBe("error");
  });
});
