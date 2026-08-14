import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/http";
import { requestAudits } from "@/lib/request-audit";
import { withUser } from "@/lib/authed-route";

/**
 * Mint/revoke iCal feed capability tokens. Only the SHA-256 hash is stored;
 * the plaintext token is returned exactly once. Rows are written with the
 * user-scoped client, so owner RLS applies.
 */
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

export async function POST(request: NextRequest) {
  return withUser("calendar.token.create", async ({ user, supabase }) => {
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
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      .select("id, include_amounts, created_at")
      .single();
    if (error) throw error;

    await requestAudits.calendarTokenCreated(request, user.id, {
      include_amounts: Boolean(body.includeAmounts),
    });

    return NextResponse.json({ token, row: data });
  });
}

export async function DELETE(request: NextRequest) {
  return withUser("calendar.token.revoke", async ({ user, supabase }) => {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return badRequest("Missing token id.");

    const { error } = await supabase
      .from("calendar_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", body.id);
    if (error) throw error;

    await requestAudits.calendarTokenRevoked(request, user.id, { id: body.id });

    return NextResponse.json({ ok: true });
  });
}
