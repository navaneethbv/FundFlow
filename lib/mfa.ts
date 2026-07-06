/**
 * Pure MFA step-up decision, shared by proxy.ts (page redirects), lib/http.ts
 * (API 401s), and LoginForm (showing the TOTP prompt). Supabase reports the
 * session's current assurance level and the level the user's enrolled factors
 * call for; a session below its required level must not touch protected data.
 */

// Loose string params: Supabase types AAL as an open string union
// (AuthenticatorAssuranceLevels | null), so a narrow literal type won't unify.
export function needsMfaStepUp(
  currentLevel: string | null | undefined,
  nextLevel: string | null | undefined,
): boolean {
  return nextLevel === "aal2" && currentLevel !== "aal2";
}
