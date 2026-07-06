import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { needsMfaStepUp } from "@/lib/mfa";
import { logError } from "@/lib/log";

const isProd = process.env.NODE_ENV === "production";

export interface AuthedContext {
  user: User;
  supabase: SupabaseClient;
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
