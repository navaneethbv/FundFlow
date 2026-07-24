import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Accept a household invite (4.1). The invitee must be signed in, and their
 * signup email must match the invited address — a leaked link alone is not
 * enough. The membership insert uses the service client (the invitee can't
 * pass the owner-only RLS insert policy) with every value derived from the
 * validated invite row, never from request input.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    // Not signed in: bounce to login; the user can re-open the link after.
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const { user } = auth;

  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    if (token.length < 20) {
      return NextResponse.redirect(new URL("/settings?invite=invalid", request.url));
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const service = createServiceClient();
    const { data: invite } = await service
      .from("household_invites")
      .select("id, household_id, email, expires_at, accepted_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (
      !invite ||
      invite.accepted_at ||
      new Date(invite.expires_at as string).getTime() < Date.now() ||
      (user.email ?? "").toLowerCase() !== (invite.email as string).toLowerCase()
    ) {
      return NextResponse.redirect(new URL("/settings?invite=invalid", request.url));
    }

    const { error: memberError } = await service.from("household_members").insert({
      household_id: invite.household_id,
      user_id: user.id,
      role: "member",
    });
    // Unique violation = already a member; treat as success.
    if (memberError && !memberError.message.includes("duplicate")) throw memberError;

    await service
      .from("household_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    await writeAudit({
      userId: user.id,
      action: "household_invite_accepted",
      metadata: { household_id: invite.household_id },
      ip: getClientIp(request),
    });

    return NextResponse.redirect(new URL("/settings?invite=accepted", request.url));
  } catch (error) {
    return errorResponse("household.accept", error);
  }
}
