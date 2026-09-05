import { beforeAll, expect } from "vitest";
import path from "node:path";
import { config } from "dotenv";

// Load local env for tests (encryption key, Supabase keys for integration).
config({ path: ".env.local" });

/**
 * Environment variable naming the one Supabase project integration tests are
 * allowed to touch. Integration tests create and delete throwaway users, so
 * pointing them at a project holding real data is destructive.
 */
export const TEST_TARGET_ENV_VAR = "TEST_SUPABASE_URL";

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Fail-closed guard on the database integration tests run against.
 *
 * The previous version only blocked when an optional PRODUCTION_SUPABASE_URL
 * happened to be configured *and* matched, so the default posture on a normal
 * developer machine -- `.env.local` pointing at the personal project, no
 * production variable set -- was to allow the run. That is exactly backwards:
 * the guard has to deny unless a target has been explicitly approved.
 *
 * So approval is now positive and explicit. `TEST_SUPABASE_URL` must be set and
 * must equal the URL under test; anything else refuses. Silence is a refusal,
 * not consent.
 */
export function assertSafeTestDatabase(url?: string): void {
  const targetUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!targetUrl) {
    throw new Error(
      "Integration tests need NEXT_PUBLIC_SUPABASE_URL. Refusing to run against an unknown database.",
    );
  }

  const approvedUrl = process.env[TEST_TARGET_ENV_VAR] ?? "";
  if (!approvedUrl) {
    throw new Error(
      `Refusing to run integration tests against ${targetUrl}: no isolated test target is approved. ` +
        `Set ${TEST_TARGET_ENV_VAR} to the URL of a throwaway Supabase project (never one holding real ` +
        `user data) to opt in. Unit tests (npm run test:unit) need none of this.`,
    );
  }

  if (normalizeUrl(approvedUrl) !== normalizeUrl(targetUrl)) {
    throw new Error(
      `Refusing to run integration tests against ${targetUrl}: it is not the approved test target ` +
        `named by ${TEST_TARGET_ENV_VAR} (${approvedUrl}).`,
    );
  }

  // Belt and braces: even an "approved" URL is refused if it is the designated
  // production project, which catches an approval variable copied by mistake.
  const productionHost = process.env.PRODUCTION_SUPABASE_URL || process.env.FUNDFLOW_PROD_URL;
  if (productionHost && targetUrl.includes(productionHost)) {
    throw new Error(
      `Refusing to run tests against designated production database: ${targetUrl}`,
    );
  }
}

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
