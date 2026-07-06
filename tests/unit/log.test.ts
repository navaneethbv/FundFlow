import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redact, logError } from "@/lib/log";

describe("redact", () => {
  it("does not modify primitive values that are not sensitive", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(123)).toBe(123);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
  });

  it("redacts sensitive fields in a flat object", () => {
    const input = {
      username: "user1",
      password: "my-secret-password",
      access_token: "access-token-123",
      public_token: "public-token-456",
      token: "some-token",
      secret: "shhh",
      account_number: "123456789",
      routing_number: "987654321",
      ssn: "000-00-0000",
      authorization: "Bearer xyz",
      cookie: "session=abc",
      ok: true,
    };

    const output = redact(input) as Record<string, unknown>;

    expect(output.username).toBe("user1");
    expect(output.ok).toBe(true);

    expect(output.password).toBe("[redacted]");
    expect(output.access_token).toBe("[redacted]");
    expect(output.public_token).toBe("[redacted]");
    expect(output.token).toBe("[redacted]");
    expect(output.secret).toBe("[redacted]");
    expect(output.account_number).toBe("[redacted]");
    expect(output.routing_number).toBe("[redacted]");
    expect(output.ssn).toBe("[redacted]");
    expect(output.authorization).toBe("[redacted]");
    expect(output.cookie).toBe("[redacted]");
  });

  it("redacts case-insensitively", () => {
    const input = {
      AccessToken: "secret1",
      SECRET: "secret2",
    };
    const output = redact(input) as Record<string, unknown>;
    expect(output.AccessToken).toBe("[redacted]");
    expect(output.SECRET).toBe("[redacted]");
  });

  it("redacts values inside nested objects and arrays", () => {
    const input = {
      user: {
        name: "John",
        secret: "confidential",
      },
      // Note: Key must not contain sensitive substrings like "token" or "secret",
      // otherwise the entire array/object gets redacted at the parent key level.
      items: [
        { type: "oauth", token: "abc" },
        { type: "jwt", token: "def" },
      ],
      safeArray: ["a", "b"],
    };

    const output = redact(input) as {
      user: { name: string; secret: string };
      items: { type: string; token: string }[];
      safeArray: string[];
    };

    expect(output.user.name).toBe("John");
    expect(output.user.secret).toBe("[redacted]");
    expect(output.items[0].token).toBe("[redacted]");
    expect(output.items[1].token).toBe("[redacted]");
    expect(output.items[0].type).toBe("oauth");
    expect(output.safeArray).toEqual(["a", "b"]);
  });
});

describe("logError", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs formatted error messages to console.error", () => {
    const err = new Error("Something went wrong");
    logError("my-context", err);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const arg1 = consoleErrorSpy.mock.calls[0][0];
    const arg2 = consoleErrorSpy.mock.calls[0][1];

    expect(arg1).toBe("[my-context] Something went wrong");
    expect(arg2).toContain("Error: Something went wrong");
  });

  it("handles non-Error objects by converting them to strings", () => {
    logError("another-context", "custom string error");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const arg1 = consoleErrorSpy.mock.calls[0][0];
    const arg2 = consoleErrorSpy.mock.calls[0][1];

    expect(arg1).toBe("[another-context] custom string error");
    expect(arg2).toBe("");
  });
});
