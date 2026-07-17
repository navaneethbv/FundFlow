import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { needsMfaStepUp } from "@/lib/mfa";
import { logError } from "@/lib/log";
import { decodeSessionId } from "@/lib/session-token";

const isProd = process.env.NODE_ENV === "production";

export interface AuthedContext {
  user: User;
  supabase: SupabaseClient;
}

/**
 * The Supabase session id (the JWT `session_id` claim) for the current request,
 * or null if it can't be read. Uses decodeSessionId to extract the claim
 * without verification — `getUser()` already validated the session against the auth server.
 * Used to key the device/session list and to enforce session revocation.
 */
export async function currentSessionId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return decodeSessionId(session?.access_token);
}

/**
 * Resolve the authenticated user for a Route Handler. Returns a 401 JSON
 * response when there is no valid session. Usage:
 *
 *   const auth = await requireUser();
 *   if (auth instanceof NextResponse) return auth;
 *   const { user, supabase } = auth;
 */
export async function requireUser(): Promise<AuthedContext | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Enforce MFA server-side: an MFA-enrolled user with a password-only (aal1)
  // session must complete the TOTP challenge before any API grants access.
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (needsMfaStepUp(aal?.currentLevel, aal?.nextLevel)) {
    return NextResponse.json(
      { error: "MFA verification required" },
      { status: 401 },
    );
  }

  // Record this session for the device list and enforce user-initiated
  // revocation: once a session record is revoked, every subsequent API call
  // from it returns 401. The recording is best-effort — a transient failure
  // here must fall open, not lock the user out of the whole app.
  try {
    const sessionId = await currentSessionId(supabase);
    if (sessionId) {
      let userAgent: string | null = null;
      try {
        userAgent = (await headers()).get("user-agent");
      } catch {
        // headers() is unavailable outside a request scope (e.g. unit tests).
      }
      const { data: record } = await supabase
        .from("user_session_records")
        .upsert(
          {
            user_id: user.id,
            session_id: sessionId,
            user_agent: userAgent,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "user_id,session_id" },
        )
        .select("revoked_at")
        .maybeSingle();
      if (record?.revoked_at) {
        return NextResponse.json({ error: "Session revoked" }, { status: 401 });
      }
    }
  } catch (error) {
    logError("session.record", error);
  }

  return { user, supabase };
}

/** Generic error response. Hides internal details in production. */
export function errorResponse(
  context: string,
  error: unknown,
  status = 500,
): NextResponse {
  logError(context, error);
  const message = isProd
    ? "Something went wrong. Please try again."
    : error instanceof Error
      ? error.message
      : String(error);
  return NextResponse.json({ error: message }, { status });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Like requireUser, but also enforces the admin role (RBAC) for debug/admin
 * endpoints. Returns 401 if unauthenticated, 403 if not an admin.
 */
export async function requireAdmin(): Promise<AuthedContext | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return auth;
}
