import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Encrypted backup archives (roadmap 2.1): gzip the takeout JSON, then
 * AES-256-GCM with a dedicated BACKUP_ENC_KEY (never the Plaid token key —
 * a leaked backup key must not unlock bank tokens, and vice versa).
 * The output is a small JSON envelope so a restore script can be a few
 * lines of node. Finance JSON compresses ~10:1, keeping email attachments
 * viable for years of history.
 *
 * New archives are encrypted with a per-user key derived from BACKUP_ENC_KEY
 * via HKDF-SHA256 (salt = user id, info = version tag). A compromise of the
 * master key alone is therefore not enough to decrypt an archive — the
 * attacker would also need each user id — and a leak of one derived key does
 * not expose other users' archives. Archives written before this scheme still
 * decrypt with the raw BACKUP_ENC_KEY (no `kdf` field in the envelope).
 */

interface BackupEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
  kdf?: "hkdf-sha256-v1";
  user_id?: string;
}

const KDF_INFO = "fundflow-backup-v1";

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_ENC_KEY must be 32 bytes base64");
  }
  return key;
}

/** Derive a user-specific AES key from the global master key. */
function deriveKey(masterBase64: string, userId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      parseKey(masterBase64),
      Buffer.from(userId, "utf8"),
      Buffer.from(KDF_INFO, "utf8"),
      32,
    ),
  );
}

export function buildBackupArchive(
  payload: unknown,
  keyBase64: string,
  userId?: string,
): Buffer {
  const key = userId ? deriveKey(keyBase64, userId) : parseKey(keyBase64);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const envelope: BackupEnvelope = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  if (userId) {
    envelope.kdf = "hkdf-sha256-v1";
    envelope.user_id = userId;
  }
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function readBackupArchive(archive: Buffer, keyBase64: string): unknown {
  const envelope = JSON.parse(archive.toString("utf8")) as BackupEnvelope;
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("Unsupported backup envelope");
  }
  const key =
    envelope.kdf === "hkdf-sha256-v1" && envelope.user_id
      ? deriveKey(keyBase64, envelope.user_id)
      : parseKey(keyBase64);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}
