import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Mint/revoke iCal feed capability tokens. Only the SHA-256 hash is stored;
 * the plaintext token is returned exactly once. Rows are written with the
 * user-scoped client, so owner RLS applies.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      includeAmounts?: boolean;
    };
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const { data, error } = await supabase
      .from("calendar_tokens")
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        include_amounts: Boolean(body.includeAmounts),
      })
      .select("id, include_amounts, created_at")
      .single();
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "calendar_token_created",
      metadata: { include_amounts: Boolean(body.includeAmounts) },
      ip: getClientIp(request),
    });

    return NextResponse.json({ token, row: data });
  } catch (error) {
    return errorResponse("calendar.token.create", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return badRequest("Missing token id.");

    const { error } = await supabase
      .from("calendar_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "calendar_token_revoked",
      metadata: { id: body.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("calendar.token.revoke", error);
  }
}
