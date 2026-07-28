import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { API_TOKEN_PREFIX, hashApiToken } from "@/lib/api-tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";

/** Mint/revoke personal read-only API tokens (6.1). Plaintext shown once. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(`api-token-mint:${user.id}`, 5, 24 * 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many tokens created today." }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = body.name?.trim();
    if (!name || name.length > 80) return badRequest("A token name (≤80 chars) is required");

    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const { data, error } = await supabase
      .from("api_tokens")
      .insert({ user_id: user.id, name, token_hash: hashApiToken(token) })
      .select("id, name, created_at")
      .single();
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "api_token_created",
      metadata: { name },
      ip: getClientIp(request),
    });

    return NextResponse.json({ token, row: data });
  } catch (error) {
    return errorResponse("tokens.create", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return badRequest("Missing token id");

    const { error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "api_token_revoked",
      metadata: { id: body.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("tokens.revoke", error);
  }
}
