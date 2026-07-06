import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  decryptSecretDetailed,
  safeEqual,
} from "@/lib/crypto";

beforeAll(() => {
  // Ensure a valid 32-byte key exists even if .env.local didn't set one.
  if (!process.env.PLAID_TOKEN_ENC_KEY) {
    process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  }
});

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips a Plaid access token", () => {
    const token = "access-sandbox-11111111-2222-3333-4444-555555555555";
    const enc = encryptSecret(token);

    expect(enc.ciphertext).not.toContain(token);
    expect(enc.iv).toBeTruthy();
    expect(enc.tag).toBeTruthy();
    expect(decryptSecret(enc)).toBe(token);
  });

  it("produces a unique IV/ciphertext per call", () => {
    const a = encryptSecret("same-secret");
    const b = encryptSecret("same-secret");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails to decrypt if the ciphertext is tampered with", () => {
    const enc = encryptSecret("tamper-me");
    const flipped = Buffer.from(enc.ciphertext, "base64");
    flipped[0] ^= 0xff;
    const tampered = { ...enc, ciphertext: flipped.toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails to decrypt with a wrong auth tag", () => {
    const enc = encryptSecret("integrity");
    const badTag = randomBytes(16).toString("base64");
    expect(() => decryptSecret({ ...enc, tag: badTag })).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    const prev = process.env.PLAID_TOKEN_ENC_KEY;
    process.env.PLAID_TOKEN_ENC_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow();
    process.env.PLAID_TOKEN_ENC_KEY = prev;
  });
});

describe("key rotation (PLAID_TOKEN_ENC_KEY_PREVIOUS)", () => {
  afterEach(() => {
    delete process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS;
  });

  it("decrypts old-key ciphertext via the fallback and flags it for re-encryption", () => {
    const oldKey = process.env.PLAID_TOKEN_ENC_KEY!;
    const enc = encryptSecret("rotate-me"); // encrypted with the old key

    // Rotate: new primary, old key demoted to fallback.
    process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
    process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS = oldKey;

    const result = decryptSecretDetailed(enc);
    expect(result.plaintext).toBe("rotate-me");
    expect(result.usedFallbackKey).toBe(true);

    // New encryptions use the new key — no fallback needed.
    const fresh = decryptSecretDetailed(encryptSecret("fresh"));
    expect(fresh.usedFallbackKey).toBe(false);

    process.env.PLAID_TOKEN_ENC_KEY = oldKey;
  });

  it("still fails when neither key matches", () => {
    const enc = encryptSecret("unreachable");
    const original = process.env.PLAID_TOKEN_ENC_KEY!;
    process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
    process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS = randomBytes(32).toString("base64");
    expect(() => decryptSecret(enc)).toThrow();
    process.env.PLAID_TOKEN_ENC_KEY = original;
  });
});

describe("safeEqual", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
