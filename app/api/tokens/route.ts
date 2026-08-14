import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/http";
import { API_TOKEN_PREFIX, hashApiToken } from "@/lib/api-tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeRequestAudit } from "@/lib/request-audit";
import { withUser } from "@/lib/authed-route";

/** Mint/revoke personal read-only API tokens (6.1). Plaintext shown once. */
export async function POST(request: NextRequest) {
  return withUser("tokens.create", async ({ user, supabase }) => {
    const allowed = await checkRateLimit(`api-token-mint:${user.id}`, 5, 24 * 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Too many tokens created today." }, { status: 429 });
    }

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

    await writeRequestAudit(request, user.id, "api_token_created", { name });

    return NextResponse.json({ token, row: data });
  });
}

export async function DELETE(request: NextRequest) {
  return withUser("tokens.revoke", async ({ user, supabase }) => {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return badRequest("Missing token id");

    const { error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", body.id);
    if (error) throw error;

    await writeRequestAudit(request, user.id, "api_token_revoked", { id: body.id });

    return NextResponse.json({ ok: true });
  });
}
