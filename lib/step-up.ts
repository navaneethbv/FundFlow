import type { SupabaseClient, User } from "@supabase/supabase-js";

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
 * (account deletion, backup restore).
 */
export async function verifyStepUp(
  supabase: SupabaseClient,
  user: User,
  code: string,
): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = (data?.totp ?? []).filter(
    (factor) => factor.status === "verified",
  );

  if (factors.length > 0) {
    for (const factor of factors) {
      try {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code,
        });
        if (!error) return true;
      } catch {
        // Wrong code for this factor; try the next verified factor.
      }
    }
    return false;
  }

  if (!user.email) return false;
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: code,
  });
  return !error;
}
