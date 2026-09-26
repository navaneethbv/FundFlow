import { beforeAll, expect } from "vitest";
import path from "node:path";
import { config } from "dotenv";

// Load local env for tests (encryption key, Supabase keys for integration).
config({ path: ".env.local" });

// Ensure a valid 32-byte fallback key in test environments (like CI) where .env.local is not present
if (!process.env.PLAID_TOKEN_ENC_KEY) {
  process.env.PLAID_TOKEN_ENC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
}

export { assertSafeTestDatabase, TEST_TARGET_ENV_VAR } from "./safe-test-database";
import { assertSafeTestDatabase } from "./safe-test-database";

/** Path fragment identifying the suite that talks to a real Supabase project. */
const INTEGRATION_DIR = `${path.sep}tests${path.sep}integration${path.sep}`;

/**
 * Gate the integration suite only. Unit tests never open a database connection,
 * so blocking them on an approved target would just be noise -- but an
 * integration file that has real credentials and no approval must not run, and
 * it fails loudly rather than skipping, because a guard that silently skips is
 * a guard nobody notices they have disabled.
 */
beforeAll(() => {
  const testPath = expect.getState().testPath ?? "";
  const isIntegration = testPath.split("/").join(path.sep).includes(INTEGRATION_DIR);
  if (isIntegration && process.env.SUPABASE_SECRET_KEY) {
    assertSafeTestDatabase();
  }
});
