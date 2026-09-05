import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSafeTestDatabase, TEST_TARGET_ENV_VAR } from "../setup";

/**
 * FF-30. The old guard blocked only when an optional PRODUCTION_SUPABASE_URL
 * was configured *and* matched, so on a normal machine (personal project in
 * .env.local, no production variable) it allowed the run. Approval now has to
 * be positive and explicit.
 */
describe("assertSafeTestDatabase", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env[TEST_TARGET_ENV_VAR];
    delete process.env.PRODUCTION_SUPABASE_URL;
    delete process.env.FUNDFLOW_PROD_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://personal.supabase.co";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses when no isolated target has been approved", () => {
    // The exact case the old guard let through.
    expect(() => assertSafeTestDatabase()).toThrow(/no isolated test target is approved/);
  });

  it("refuses a target that is not the approved one", () => {
    process.env[TEST_TARGET_ENV_VAR] = "https://throwaway.supabase.co";

    expect(() => assertSafeTestDatabase()).toThrow(/not the approved test target/);
  });

  it("allows the explicitly approved target", () => {
    process.env[TEST_TARGET_ENV_VAR] = "https://throwaway.supabase.co";

    expect(() =>
      assertSafeTestDatabase("https://throwaway.supabase.co"),
    ).not.toThrow();
  });

  it("ignores a trailing slash and case when comparing the approval", () => {
    process.env[TEST_TARGET_ENV_VAR] = "https://Throwaway.supabase.co/";

    expect(() => assertSafeTestDatabase("https://throwaway.supabase.co")).not.toThrow();
  });

  it("refuses when the database under test is unknown", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";

    expect(() => assertSafeTestDatabase()).toThrow(/Refusing to run against an unknown database/);
  });

  it("still refuses the designated production project even once approved", () => {
    process.env[TEST_TARGET_ENV_VAR] = "https://prod.supabase.co";
    process.env.PRODUCTION_SUPABASE_URL = "prod.supabase.co";

    expect(() => assertSafeTestDatabase("https://prod.supabase.co")).toThrow(
      /designated production database/,
    );
  });

  it("honours FUNDFLOW_PROD_URL as the production marker too", () => {
    process.env[TEST_TARGET_ENV_VAR] = "https://prod.supabase.co";
    process.env.FUNDFLOW_PROD_URL = "prod.supabase.co";

    expect(() => assertSafeTestDatabase("https://prod.supabase.co")).toThrow(
      /designated production database/,
    );
  });
});
