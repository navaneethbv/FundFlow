import { describe, it, expect } from "vitest";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_ENV,
  isFeatureEnabled,
  resolveFeatureFlags,
} from "@/lib/feature-flags";

describe("feature flags", () => {
  it("ships Accounts, Cash Flow, and Budget by default", () => {
    expect(isFeatureEnabled("accountsPage", {})).toBe(true);
    expect(isFeatureEnabled("cashFlowPage", {})).toBe(true);
    expect(isFeatureEnabled("budgetPage", {})).toBe(true);
  });

  it("resolves feature flags from environment", () => {
    const env = { [FEATURE_FLAG_ENV]: "accountsPage, cashFlowPage, budgetPage" };
    expect(isFeatureEnabled("accountsPage", env)).toBe(true);
    expect(isFeatureEnabled("cashFlowPage", env)).toBe(true);
    expect(isFeatureEnabled("budgetPage", env)).toBe(true);
  });

  it("ignores unknown names instead of throwing", () => {
    const env = { [FEATURE_FLAG_ENV]: "notAFlag,,accountsPage" };
    expect(() => resolveFeatureFlags(env)).not.toThrow();
    expect(resolveFeatureFlags(env).accountsPage).toBe(true);
  });

  it("resolves every known flag", () => {
    const resolved = resolveFeatureFlags({});
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(FEATURE_FLAG_DEFAULTS).sort());
  });

  it("includes recurringPage in the default flag set, enabled", () => {
    expect(FEATURE_FLAG_DEFAULTS.recurringPage).toBe(true);
    expect(isFeatureEnabled("recurringPage")).toBe(true);
  });

  it("ships transactionsParity now that its migration is applied", () => {
    expect(isFeatureEnabled("transactionsParity", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(true);
    expect(
      isFeatureEnabled("transactionsParity", { FUNDFLOW_FEATURE_FLAGS: "transactionsParity" }),
    ).toBe(true);
  });

  it("ships settingsIa now that its migration is applied", () => {
    expect(isFeatureEnabled("settingsIa", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(true);
    expect(isFeatureEnabled("settingsIa", { FUNDFLOW_FEATURE_FLAGS: "settingsIa" })).toBe(true);
  });
});
