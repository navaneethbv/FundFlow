import { verifyStepUp } from "@/lib/step-up";
import { createServiceClient } from "@/lib/supabase/service";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/http";
import { API_TOKEN_PREFIX, hashApiToken } from "@/lib/api-tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestAudits } from "@/lib/request-audit";
import { withUser } from "@/lib/authed-route";

/** Mint/revoke personal read-only API tokens (6.1). Plaintext shown once. */
export async function POST(request: NextRequest) {
  return withUser("tokens.create", async ({ user, supabase }) => {
    const allowed = await checkRateLimit(`api-token-mint:${user.id}`, 5, 24 * 3600, { failClosed: true });
    if (!allowed) {
      return NextResponse.json({ error: "Too many tokens created today." }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as { name?: string; code?: string; factorId?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return badRequest("A token name (≤80 chars) is required");

    if (typeof body.code !== "string" || !await verifyStepUp(supabase, user, body.code, body.factorId)) {
      return NextResponse.json({ error: "Reauthentication required" }, { status: 403 });
    }
    const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const { data, error } = await createServiceClient()
      .from("api_tokens")
      .insert({ user_id: user.id, name, token_hash: hashApiToken(token), expires_at: expiresAt })
      .select("id, name, created_at, expires_at")
      .single();
    if (error) throw error;

    await requestAudits.apiTokenCreated(request, user.id, { name });

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

    await requestAudits.apiTokenRevoked(request, user.id, { id: body.id });

    return NextResponse.json({ ok: true });
  });
}
