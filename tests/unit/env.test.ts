import { describe, it, expect, afterAll } from "vitest";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

describe("publicEnv", () => {
  it("resolves the defined public environment variables", () => {
    expect(publicEnv.supabaseUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(publicEnv.supabasePublishableKey).toBe(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    expect(publicEnv.appUrl).toBe(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    );
  });
});

describe("serverEnv lazy getters", () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      process.env[key] = val;
    }
  });

  it("resolves variables correctly when present", () => {
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
    process.env.PLAID_CLIENT_ID = "test-plaid-id";
    process.env.PLAID_SECRET = "test-plaid-secret";
    process.env.PLAID_ENV = "development";
    process.env.PLAID_PRODUCTS = "auth,transactions,identity";
    process.env.PLAID_COUNTRY_CODES = "US,CA";
    process.env.PLAID_TOKEN_ENC_KEY = "test-enc-key";
    process.env.CRON_SECRET = "test-cron-secret";

    expect(serverEnv.supabaseSecretKey).toBe("test-secret-key");
    expect(serverEnv.plaidClientId).toBe("test-plaid-id");
    expect(serverEnv.plaidSecret).toBe("test-plaid-secret");
    expect(serverEnv.plaidEnv).toBe("development");
    expect(serverEnv.plaidProducts).toEqual(["auth", "transactions", "identity"]);
    expect(serverEnv.plaidCountryCodes).toEqual(["US", "CA"]);
    expect(serverEnv.tokenEncKey).toBe("test-enc-key");
    expect(serverEnv.cronSecret).toBe("test-cron-secret");
  });

  it("throws validation errors for missing required variables", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => serverEnv.supabaseSecretKey).toThrow("SUPABASE_SECRET_KEY");

    delete process.env.PLAID_CLIENT_ID;
    expect(() => serverEnv.plaidClientId).toThrow("PLAID_CLIENT_ID");

    delete process.env.PLAID_SECRET;
    expect(() => serverEnv.plaidSecret).toThrow("PLAID_SECRET");

    delete process.env.PLAID_TOKEN_ENC_KEY;
    expect(() => serverEnv.tokenEncKey).toThrow("PLAID_TOKEN_ENC_KEY");

    delete process.env.CRON_SECRET;
    expect(() => serverEnv.cronSecret).toThrow("CRON_SECRET");
  });

  it("uses default values when optional variables are absent", () => {
    delete process.env.PLAID_ENV;
    delete process.env.PLAID_PRODUCTS;
    delete process.env.PLAID_COUNTRY_CODES;

    expect(serverEnv.plaidEnv).toBe("sandbox");
    expect(serverEnv.plaidProducts).toEqual(["transactions"]);
    expect(serverEnv.plaidCountryCodes).toEqual(["US"]);
  });
});
