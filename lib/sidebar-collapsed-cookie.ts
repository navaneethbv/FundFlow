/**
 * The sidebar collapse preference, mirrored into a cookie.
 *
 * The authoritative copy is `profiles.dashboard_prefs.sidebarCollapsed`, but
 * `loading.tsx` (RouteSkeleton) renders the shell with zero Supabase round
 * trips, so it has no way to read that. This cookie gives the skeleton the
 * right width immediately; without it the frame paints expanded and snaps
 * closed once the real page resolves, on every navigation.
 *
 * Cleared on sign-out so the next account on a shared browser does not
 * inherit the previous one's layout.
 */
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed";

const ONE_YEAR_SECONDS = 31536000;

function secureAttribute(): string {
  return globalThis.location?.protocol === "https:" ? "; Secure" : "";
}

export function writeSidebarCollapsedCookie(value: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax${secureAttribute()}`;
}

export function clearSidebarCollapsedCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=; path=/; max-age=0; SameSite=Lax${secureAttribute()}`;
}
