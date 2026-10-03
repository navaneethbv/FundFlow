import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * Accept a household invite (4.1). The invitee must be signed in, and their
 * signup email must match the invited address — a leaked link alone is not
 * enough. The membership insert uses the service client (the invitee can't
 * pass the owner-only RLS insert policy) with every value derived from the
 * validated invite row, never from request input.
 */
export function GET(request: NextRequest) {
  const url = new URL("/household/accept", request.url);
  url.searchParams.set("token", request.nextUrl.searchParams.get("token") ?? "");
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Same-origin confirmation required" }, { status: 403 });
  }
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    if (auth.status !== 401) return auth;
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `/household/accept?token=${encodeURIComponent(request.nextUrl.searchParams.get("token") ?? "")}`);
    return NextResponse.redirect(login, 303);
  }
  const { user } = auth;

  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    if (token.length < 20 || token.length > 256) {
      return NextResponse.redirect(new URL("/settings?invite=invalid", request.url), 303);
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const service = createServiceClient();
    const reportsOnlyEnabled = isFeatureEnabled("householdReportsOnly");
    const { data: invite, error: inviteError } = await service
      .from("household_invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (inviteError) throw inviteError;
    const inviteRow = invite as unknown as {
      id: string;
      household_id: string;
      email: string;
      role?: string;
      expires_at: string;
      accepted_at: string | null;
    } | null;
    if (
      !inviteRow ||
      inviteRow.accepted_at ||
      new Date(inviteRow.expires_at).getTime() < Date.now() ||
      (user.email ?? "").toLowerCase() !== inviteRow.email.toLowerCase()
    ) {
      return NextResponse.redirect(new URL("/settings?invite=invalid", request.url), 303);
    }

    const { error: memberError } = await service.from("household_members").insert({
      household_id: inviteRow.household_id,
      user_id: user.id,
      role: reportsOnlyEnabled && inviteRow.role === "reports_only" ? "reports_only" : "member",
    });
    // Unique violation = already a member; treat as success. Matched on the
    // Postgres code, not the message text (A-13): message wording varies by
    // layer and locale, "23505" does not.
    if (memberError && memberError.code !== "23505") throw memberError;

    // Checked (A-13): an unchecked accept leaves the invite reusable.
    const { error: acceptError } = await service
      .from("household_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", inviteRow.id);
    if (acceptError) throw acceptError;

    await writeAudit({
      userId: user.id,
      action: "household_invite_accepted",
      metadata: { household_id: inviteRow.household_id },
      ip: getClientIp(request),
    });

    return NextResponse.redirect(new URL("/settings?invite=accepted", request.url), 303);
  } catch (error) {
    return errorResponse("household.accept", error);
  }
}
