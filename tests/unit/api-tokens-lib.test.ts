import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { clientStub } from "../fixtures/supabase-query";

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { API_TOKEN_PREFIX, hashApiToken, verifyApiToken } from "@/lib/api-tokens";

const VALID = `${API_TOKEN_PREFIX}${"a".repeat(43)}`;

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub();
});

describe("hashApiToken", () => {
  it("is SHA-256 of the token and never echoes it", () => {
    const hash = hashApiToken(VALID);
    expect(hash).toBe(createHash("sha256").update(VALID).digest("hex"));
    expect(hash).not.toContain(VALID);
  });

  it("is stable and distinguishes different tokens", () => {
    expect(hashApiToken(VALID)).toBe(hashApiToken(VALID));
    expect(hashApiToken(VALID)).not.toBe(hashApiToken(`${VALID}b`));
  });
});

describe("verifyApiToken", () => {
  it.each([
    ["a missing header", null],
    ["a non-Bearer scheme", `Basic ${VALID}`],
    ["a token without the fft_ prefix", `Bearer ${"a".repeat(40)}`],
    ["a token that is too short", `Bearer ${API_TOKEN_PREFIX}short`],
  ])("rejects %s without querying", async (_label, header) => {
    await expect(verifyApiToken(header)).resolves.toBeNull();
    expect(serviceClient.callsOn("api_tokens")).toHaveLength(0);
  });

  it("returns null for a token with no matching row", async () => {
    serviceClient = clientStub({ api_tokens: { data: null } });
    await expect(verifyApiToken(`Bearer ${VALID}`)).resolves.toBeNull();
  });

  it("looks the token up by hash, excluding revoked rows", async () => {
    serviceClient = clientStub({
      api_tokens: { data: { id: "t1", user_id: "user-1" } },
    });

    await expect(verifyApiToken(`Bearer ${VALID}`)).resolves.toBe("user-1");

    const calls = serviceClient.callsOn("api_tokens");
    expect(
      calls.some(
        ({ method, args }) =>
          method === "eq" &&
          args[0] === "token_hash" &&
          args[1] === hashApiToken(VALID),
      ),
    ).toBe(true);
    expect(
      calls.some(
        ({ method, args }) => method === "is" && args[0] === "revoked_at" && args[1] === null,
      ),
    ).toBe(true);
  });

  it("stamps last_used_at without blocking the result", async () => {
    serviceClient = clientStub({
      api_tokens: { data: { id: "t1", user_id: "user-1" } },
    });

    await verifyApiToken(`Bearer ${VALID}`);

    expect(serviceClient.writtenTo("api_tokens")).toMatchObject({
      last_used_at: expect.any(String),
    });
  });

  it("tolerates a failed last_used_at stamp", async () => {
    const stub = clientStub({ api_tokens: { data: { id: "t1", user_id: "user-1" } } });
    // Make the update chain reject; the caller must still get the user id.
    const original = stub.from;
    stub.from = vi.fn((table: string) => {
      const builder = original(table) as Record<string, unknown>;
      builder.update = () => ({
        eq: () => ({
          then: (_res: unknown, reject: (e: unknown) => unknown) =>
            reject(new Error("stamp failed")),
        }),
      });
      return builder;
    }) as typeof stub.from;
    serviceClient = stub;

    await expect(verifyApiToken(`Bearer ${VALID}`)).resolves.toBe("user-1");
  });
});
