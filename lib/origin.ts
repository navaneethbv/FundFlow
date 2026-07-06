/**
 * CSRF defense-in-depth for cookie-authenticated mutating API routes.
 *
 * Browsers attach an Origin header to every POST/PUT/PATCH/DELETE; a
 * cross-site form or fetch carries the attacker's origin, which won't match
 * our host. Non-browser callers (Plaid webhooks, curl, tests) send no Origin
 * at all — those pass, because CSRF is a browser-only attack vector.
 */
export function isCrossOrigin(
  originHeader: string | null,
  requestHost: string | null,
): boolean {
  if (!originHeader || !requestHost) return false;
  try {
    return new URL(originHeader).host !== requestHost;
  } catch {
    // Malformed or opaque ("null") Origin: treat as cross-origin.
    return true;
  }
}
