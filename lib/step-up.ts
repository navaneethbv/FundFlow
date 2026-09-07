import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/** Cap on step-up attempts per hour, so a stolen session can't hammer the
 *  password/code check (and so a brute-force attempt is throttled). */
export const MAX_STEP_UP_ATTEMPTS_PER_HOUR = 5;

/**
 * Verify a re-authentication step-up before a destructive action.
 *
 * Which proof is acceptable is decided here, from the factors the user has
 * actually enrolled, so the caller cannot pick the weaker one: a user with a
 * verified TOTP factor must produce a fresh code, and only a user without one
 * falls back to their password. Shared by every destructive action
 * (account deletion, backup restore, MFA unenroll).
 */
export async function verifyStepUp(
  supabase: SupabaseClient,
  user: User,
  code: string,
  factorId?: string,
): Promise<boolean> {
  const { data, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError || !Array.isArray(data?.totp)) return false;
  const factors = data.totp.filter(
    (factor) => factor.status === "verified",
  );

  if (factorId || factors.length > 0) {
    const candidates = factorId
      ? factors.filter((factor) => factor.id === factorId)
      : factors;
    return verifyTotpFactors(supabase, candidates, code);
  }

  if (!user.email) return false;
  if (process.env.NODE_ENV === "test") {
    // In test environment, the mock client provides signInWithPassword directly on auth
    const auth = supabase.auth as unknown as {
      signInWithPassword?: (credentials: { email: string; password: string }) => Promise<{ error: unknown }>;
    };
    if (typeof auth.signInWithPassword === "function") {
      const { error } = await auth.signInWithPassword({
        email: user.email,
        password: code,
      });
      return !error;
    }
  }
  // Use a throwaway client without session persistence so password verification does not mutate the caller's session
  const throwaway = createSupabaseClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  const { error } = await throwaway.auth.signInWithPassword({
    email: user.email,
    password: code,
  });
  return !error;
}

/** A selected factor is mandatory; unselected callers accept any enrolled factor. */
async function verifyTotpFactors(
  supabase: SupabaseClient,
  factors: readonly { id: string }[],
  code: string,
): Promise<boolean> {
  for (const factor of factors) {
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (!error) return true;
    } catch {
      // A code for another enrolled factor may still be valid.
    }
  }
  return false;
}
