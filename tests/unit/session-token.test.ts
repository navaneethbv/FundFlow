import { describe, it, expect } from "vitest";
import { decodeSessionId } from "@/lib/session-token";

function makeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("decodeSessionId", () => {
  it("returns the session_id claim from a JWT payload", () => {
    expect(decodeSessionId(makeToken({ session_id: "abc-123" }))).toBe("abc-123");
  });

  it("returns null when the claim is missing or not a string", () => {
    expect(decodeSessionId(makeToken({}))).toBeNull();
    expect(decodeSessionId(makeToken({ session_id: 42 }))).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decodeSessionId(null)).toBeNull();
    expect(decodeSessionId(undefined)).toBeNull();
    expect(decodeSessionId("")).toBeNull();
    expect(decodeSessionId("not-a-jwt")).toBeNull();
    expect(decodeSessionId("a.%%%%.c")).toBeNull();
  });
});
