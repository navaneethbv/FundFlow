import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated symmetric encryption for Plaid access tokens (and any secret we
 * must store at rest). AES-256-GCM: confidentiality + integrity via the auth tag.
 *
 * The key comes from PLAID_TOKEN_ENC_KEY (32 raw bytes, base64-encoded). Read
 * lazily so this module stays importable in tests that set only this one var.
 *
 * Rotation: set PLAID_TOKEN_ENC_KEY to the new key and move the old one to
 * PLAID_TOKEN_ENC_KEY_PREVIOUS. Encryption always uses the new key; decryption
 * falls back to the previous key (GCM's auth tag makes a wrong-key attempt fail
 * loudly, never silently). The daily sync re-encrypts any token it had to
 * decrypt with the fallback, so PREVIOUS can be removed once syncs are clean.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the standard for GCM
const KEY_BYTES = 32; // AES-256

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 GCM auth tag
}

function decodeKey(name: string, encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${name} must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

function getKey(): Buffer {
  const encoded = process.env.PLAID_TOKEN_ENC_KEY;
  if (!encoded) {
    throw new Error("Missing PLAID_TOKEN_ENC_KEY");
  }
  return decodeKey("PLAID_TOKEN_ENC_KEY", encoded);
}

/** Current key first, then the rotation fallback if configured. */
function getDecryptionKeys(): Buffer[] {
  const keys = [getKey()];
  const previous = process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS;
  if (previous) {
    keys.push(decodeKey("PLAID_TOKEN_ENC_KEY_PREVIOUS", previous));
  }
  return keys;
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export interface DecryptedSecret {
  plaintext: string;
  /** True when the rotation fallback key was needed — re-encrypt this secret. */
  usedFallbackKey: boolean;
}

/** Decrypt, reporting whether the previous (rotation) key had to be used. */
export function decryptSecretDetailed(
  payload: EncryptedPayload,
): DecryptedSecret {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const keys = getDecryptionKeys();
  let lastError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      const decipher = createDecipheriv(ALGORITHM, keys[i]!, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // throws if the key is wrong or data was tampered with
      ]);
      return { plaintext: plaintext.toString("utf8"), usedFallbackKey: i > 0 };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function decryptSecret(payload: EncryptedPayload): string {
  return decryptSecretDetailed(payload).plaintext;
}

/** Constant-time string comparison for secrets (e.g. cron token). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
