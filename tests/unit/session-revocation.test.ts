import { describe, it, expect, vi } from "vitest";
import { isSessionRevoked } from "@/lib/session-revocation";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

function makeToken(sessionId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ session_id: sessionId }),
  ).toString("base64url");
  return `h.${payload}.s`;
}

function mockClient(opts: {
  accessToken?: string | null;
  revokedAt?: string | null;
  lookupError?: boolean;
  noRow?: boolean;
}): SupabaseClient {
  const maybeSingle = vi.fn(async () => {
    if (opts.lookupError) throw new Error("db down");
    if (opts.noRow) return { data: null, error: null };
    return { data: { revoked_at: opts.revokedAt ?? null }, error: null };
  });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle,
  };
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: opts.accessToken ? { access_token: opts.accessToken } : null,
        },
      })),
    },
    from: vi.fn(() => chain),
  } as unknown as SupabaseClient;
}

describe("isSessionRevoked", () => {
  it("returns true when the session record is revoked", async () => {
    const client = mockClient({
      accessToken: makeToken("s1"),
      revokedAt: "2026-07-16T00:00:00Z",
    });
    expect(await isSessionRevoked(client, "u1")).toBe(true);
  });

  it("returns false for an active session record", async () => {
    const client = mockClient({ accessToken: makeToken("s1"), revokedAt: null });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("returns false when no record exists (fresh login not yet recorded)", async () => {
    const client = mockClient({ accessToken: makeToken("s1"), noRow: true });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("returns false when the session id cannot be decoded", async () => {
    const client = mockClient({ accessToken: null });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("fails open on lookup errors", async () => {
    const client = mockClient({
      accessToken: makeToken("s1"),
      lookupError: true,
    });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      "session-revocation.lookup",
      expect.any(Error),
    );
  });
});
