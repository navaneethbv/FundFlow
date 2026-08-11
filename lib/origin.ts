/**
 * CSRF defense-in-depth for cookie-authenticated mutating API routes.
 *
 * Browsers attach an Origin header to every POST/PUT/PATCH/DELETE; a
 * cross-site form or fetch carries the attacker's origin, which won't match
 * our host. Non-browser callers (Plaid webhooks, cron, tests) send no Origin
 * at all — those pass, because CSRF is a browser-only attack vector.
 *
 * The expected host is derived only from the `Host` header the platform or
 * reverse proxy set, never from client-spoofable headers like
 * `x-forwarded-host`. On top of that, the Origin must match an explicit
 * allowlist: the canonical app URL, the Vercel-managed deployment host, or
 * the request's own Host.
 */
export function isCrossOrigin(
  originHeader: string | null,
  requestHost: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!originHeader || !requestHost) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    // Malformed or opaque ("null") Origin: treat as cross-origin.
    return true;
  }

  const allowed = new Set<string>();

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // Unparseable config: ignore, the remaining entries still apply.
    }
  }

  // Vercel-managed deployment host (set by the platform, never the client) —
  // covers preview deployments whose domain differs from NEXT_PUBLIC_APP_URL.
  const vercelUrl = env.VERCEL_URL;
  if (vercelUrl) allowed.add(`https://${vercelUrl}`);

  // The request's own Host header, matched against the scheme the caller used
  // so local http and production https both work. This is the fallback for
  // self-hosted deployments that don't set NEXT_PUBLIC_APP_URL.
  allowed.add(`${originUrl.protocol}//${requestHost}`);

  return !allowed.has(originUrl.origin);
}
