/**
 * Decode the `session_id` claim from a Supabase access token (JWT). The
 * payload is decoded without signature verification, so callers must only
 * pass tokens that getUser() has already validated. Format-agnostic
 * (base64url JSON regardless of signing algorithm); null on malformed input.
 */
export function decodeSessionId(
  accessToken: string | null | undefined,
): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}
