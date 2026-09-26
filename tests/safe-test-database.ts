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
