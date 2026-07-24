import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendHouseholdInviteEmail } from "@/lib/reporting";
import { serverEnv } from "@/lib/env.server";
import { writeAudit, getClientIp } from "@/lib/audit";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Household invite (4.1): the owner invites a partner by email. Only the
 * token's SHA-256 hash is stored; the plaintext rides the email link and
 * is validated by /api/household/accept. Membership grants NO data
 * visibility yet — shared-data RLS (4.2) is deliberately a separate,
 * carefully-reviewed step.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(`household-invite:${user.id}`, 5, 24 * 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many invites today." }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      householdId?: string;
      email?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase();
    if (!body?.householdId || !email || !email.includes("@") || email.length > 320) {
      return badRequest("householdId and a valid email are required");
    }

    // RLS-visible only to the owner; also assert ownership explicitly.
    const { data: household } = await supabase
      .from("households")
      .select("id, name, owner_user_id")
      .eq("id", body.householdId)
      .maybeSingle();
    if (!household || household.owner_user_id !== user.id) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { error } = await supabase.from("household_invites").insert({
      household_id: household.id,
      email,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    });
    if (error) throw error;

    const acceptUrl = `${serverEnv.appUrl ?? "http://localhost:3000"}/api/household/accept?token=${token}`;
    await sendHouseholdInviteEmail(
      email,
      user.email ?? "A FundFlow user",
      household.name as string,
      acceptUrl,
    );

    await writeAudit({
      userId: user.id,
      action: "household_invite_sent",
      metadata: { household_id: household.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("household.invite", error);
  }
}
