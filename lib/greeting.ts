/**
 * Pure helpers for the sidebar user block and the Dashboard's greeting
 * header. Kept separate from `lib/profile.ts` (profile PATCH validation) —
 * a different, narrower concern.
 */

/** Preference order matches the profile form: a display name is what the
 * app addresses someone by; a full name is the fallback; the local part of
 * an email is a last resort so the greeting never shows a bare "there". */
export function resolveDisplayName({
  displayName,
  fullName,
  email,
}: {
  displayName?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const trimmedDisplay = displayName?.trim();
  if (trimmedDisplay) return trimmedDisplay;
  const trimmedFull = fullName?.trim();
  if (trimmedFull) return trimmedFull;
  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail.split("@")[0]!;
  return "there";
}

/** `hour` is 0-23, the server's local wall-clock hour at render time. */
export function greetingWord(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
