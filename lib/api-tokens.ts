import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Personal read-only API tokens (6.1): `fft_`-prefixed bearer tokens for the
 * user's own scripts. Same discipline as Plaid tokens — only SHA-256 hashes
 * are stored, the plaintext appears once at mint time, every token is
 * revocable from Settings, and the scope is hard-limited to the export
 * contract (the routes that accept them are the /api/export/* readers;
 * nothing mutating, nothing with balances or account masks).
 */

export const API_TOKEN_PREFIX = "fft_";

/**
 * SHA-256, deliberately — not bcrypt/argon2. These tokens are 256 bits of
 * `randomBytes` (see the mint route), not user-chosen passwords: there is no
 * guessable keyspace for a slow KDF to protect, and this runs on every
 * token-authenticated request, where a deliberately slow hash would only be a
 * self-inflicted DoS. Same reasoning as the calendar tokens and household
 * invites. Static analysis reads "token → sha256" as password hashing and
 * flags it; that heuristic does not apply here.
 */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves an Authorization header to a user id, or null. Best-effort
 * last_used_at stamp; a failed stamp never blocks the request.
 */
export async function verifyApiToken(
  authorizationHeader: string | null,
): Promise<string | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token.startsWith(API_TOKEN_PREFIX) || token.length < 30) return null;

  const service = createServiceClient();
  const { data: row } = await service
    .from("api_tokens")
    .select("id, user_id")
    .eq("token_hash", hashApiToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!row) return null;

  await service
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined, () => undefined);

  return row.user_id as string;
}
