import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/** Handles the email-confirmation / OAuth code exchange. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // A used/expired link would otherwise bounce to /login with no explanation.
    logError("auth.callback", error);
    return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
