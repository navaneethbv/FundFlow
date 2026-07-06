import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { needsMfaStepUp } from "@/lib/mfa";
import { isCrossOrigin } from "@/lib/origin";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PUBLIC_PAGE_PATHS = ["/login", "/signup"];

function isPublicPage(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_PAGE_PATHS.includes(pathname) ||
    pathname.startsWith("/auth")
  );
}

function supabaseHost(): string {
  return new URL(publicEnv.supabaseUrl).host;
}

function buildCsp(nonce: string): string {
  const host = supabaseHost();
  return [
    `default-src 'self'`,
    // Nonce + strict-dynamic lets Next's scripts run and load Plaid Link.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.plaid.com`,
    // Tailwind/Next inject inline styles; nonce-ing styles is impractical.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.plaid.com https://${host} wss://${host}`,
    `frame-src https://*.plaid.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // CSRF defense-in-depth: browser-sent mutating API requests must come from
  // our own origin. Non-browser callers (Plaid webhooks, cron) send no Origin
  // header and pass through; SameSite=Lax cookies remain the first layer.
  if (
    request.nextUrl.pathname.startsWith("/api") &&
    MUTATING_METHODS.has(request.method)
  ) {
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (isCrossOrigin(request.headers.get("origin"), host)) {
      const denied = NextResponse.json(
        { error: "Cross-origin request rejected" },
        { status: 403 },
      );
      applySecurityHeaders(denied, csp);
      return denied;
    }
  }

  // Pass the nonce + CSP to Next via request headers so it nonces its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the session with Supabase Auth on every
  // request. Do not trust getSession() in server code.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // MFA step-up: an MFA-enrolled user with a password-only (aal1) session is
  // NOT fully signed in. Treat them like an unauthenticated visitor for
  // protected pages; /login shows the TOTP prompt to finish the sign-in.
  let mfaPending = false;
  if (user) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaPending = needsMfaStepUp(aal?.currentLevel, aal?.nextLevel);
  }

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  // Redirect unauthenticated (or MFA-pending) users away from protected pages.
  // API routes enforce their own auth (returning JSON 401), so we don't
  // redirect those.
  if ((!user || mfaPending) && !isApi && !isPublicPage(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    applySecurityHeaders(redirect, csp);
    return redirect;
  }

  // Fully signed-in users shouldn't see the auth pages. (MFA-pending users
  // must be allowed on /login, or this would redirect-loop with the above.)
  if (user && !mfaPending && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirect = NextResponse.redirect(url);
    applySecurityHeaders(redirect, csp);
    return redirect;
  }

  applySecurityHeaders(response, csp);
  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
