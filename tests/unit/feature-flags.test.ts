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
    const env = { [FEATURE_FLAG_ENV]: "notAFlag,,accountsPage,-alsoNotAFlag" };
    expect(() => resolveFeatureFlags(env)).not.toThrow();
    expect(resolveFeatureFlags(env).accountsPage).toBe(true);
  });

  it("forces a released flag off with a - prefix", () => {
    const env = { [FEATURE_FLAG_ENV]: "-reportsPage" };
    expect(FEATURE_FLAG_DEFAULTS.reportsPage).toBe(true);
    expect(isFeatureEnabled("reportsPage", env)).toBe(false);
    expect(resolveFeatureFlags(env).reportsPage).toBe(false);
  });

  it("scopes a force-off to the named flag only", () => {
    const env = { [FEATURE_FLAG_ENV]: " -reportsPage , goalsV2 " };
    const resolved = resolveFeatureFlags(env);
    expect(resolved.reportsPage).toBe(false);
    expect(resolved.goalsV2).toBe(true);
    expect(resolved.accountsPage).toBe(true);
  });

  it("lets force-off win over an explicit force-on for the same flag", () => {
    const env = { [FEATURE_FLAG_ENV]: "reportsPage,-reportsPage" };
    expect(isFeatureEnabled("reportsPage", env)).toBe(false);
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

  it("keeps billed liabilities sync off unless explicitly enabled", () => {
    expect(FEATURE_FLAG_DEFAULTS.liabilitiesSync).toBe(false);
    expect(isFeatureEnabled("liabilitiesSync", {})).toBe(false);
    expect(
      isFeatureEnabled("liabilitiesSync", {
        FUNDFLOW_FEATURE_FLAGS: "liabilitiesSync",
      }),
    ).toBe(true);
  });

  it("keeps backup restore off unless explicitly enabled", () => {
    expect(FEATURE_FLAG_DEFAULTS.backupRestore).toBe(false);
    expect(isFeatureEnabled("backupRestore", {})).toBe(false);
    expect(
      isFeatureEnabled("backupRestore", {
        FUNDFLOW_FEATURE_FLAGS: "backupRestore",
      }),
    ).toBe(true);
  });
});
