import { describe, expect, it } from "vitest";
import { getPlaidClient } from "@/lib/plaid";
import { PlaidApi } from "plaid";

describe("getPlaidClient", () => {
  it("initializes and returns a PlaidApi client instance", () => {
    // Set required env vars to avoid validation errors
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
    process.env.PLAID_CLIENT_ID = "test-plaid-id";
    process.env.PLAID_SECRET = "test-plaid-secret";
    process.env.PLAID_TOKEN_ENC_KEY = "0123456789abcdef0123456789abcdef"; // 32 chars
    process.env.CRON_SECRET = "test-cron-secret";

    const client1 = getPlaidClient();
    expect(client1).toBeInstanceOf(PlaidApi);

    // Calling it again should return the cached instance
    const client2 = getPlaidClient();
    expect(client2).toBe(client1);
  });
});
