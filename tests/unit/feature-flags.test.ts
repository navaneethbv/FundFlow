import { describe, it, expect } from "vitest";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_ENV,
  isFeatureEnabled,
  resolveFeatureFlags,
} from "@/lib/feature-flags";

describe("feature flags", () => {
  it("keeps every unreleased page off by default", () => {
    expect(Object.values(FEATURE_FLAG_DEFAULTS).every((value) => value === false)).toBe(true);
    expect(isFeatureEnabled("accountsPage", {})).toBe(false);
  });

  it("enables the flags named in the environment", () => {
    const env = { [FEATURE_FLAG_ENV]: "accountsPage, cashFlowPage" };
    expect(isFeatureEnabled("accountsPage", env)).toBe(true);
    expect(isFeatureEnabled("cashFlowPage", env)).toBe(true);
    expect(isFeatureEnabled("budgetPage", env)).toBe(false);
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
});
