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

export const API_TOKEN_SCOPES = [
  "export:rows",
  "mcp:aggregates",
  "mcp:export-rows",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const LEGACY_EXPORT_SCOPE: ApiTokenScope = "export:rows";

export function normalizeApiTokenScopes(value: unknown): ApiTokenScope[] | null {
  if (value === undefined) return [LEGACY_EXPORT_SCOPE];
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = [...new Set(value)].filter(
    (scope): scope is ApiTokenScope =>
      typeof scope === "string" &&
      (API_TOKEN_SCOPES as readonly string[]).includes(scope),
  );
  return scopes.length === value.length ? scopes : null;
}

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
  requiredScope: ApiTokenScope,
): Promise<{ userId: string; scopes: ApiTokenScope[] } | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token.startsWith(API_TOKEN_PREFIX) || token.length < 30) return null;

  const service = createServiceClient();
  const { data: row, error } = await service
    .from("api_tokens")
    .select("id, user_id, scopes")
    .eq("token_hash", hashApiToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const scopes = Array.isArray(row.scopes)
    ? normalizeApiTokenScopes(row.scopes)
    : null;
  if (!scopes?.includes(requiredScope)) return null;

  await service
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("user_id", row.user_id)
    .then(() => undefined, () => undefined);

  return { userId: row.user_id as string, scopes };
}
