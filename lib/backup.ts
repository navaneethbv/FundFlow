import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Encrypted backup archives (roadmap 2.1): gzip the takeout JSON, then
 * AES-256-GCM with a dedicated BACKUP_ENC_KEY (never the Plaid token key —
 * a leaked backup key must not unlock bank tokens, and vice versa).
 * The output is a small JSON envelope so a restore script can be a few
 * lines of node. Finance JSON compresses ~10:1, keeping email attachments
 * viable for years of history.
 */

interface BackupEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
}

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_ENC_KEY must be 32 bytes base64");
  }
  return key;
}

export function buildBackupArchive(payload: unknown, keyBase64: string): Buffer {
  const key = parseKey(keyBase64);
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
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function readBackupArchive(archive: Buffer, keyBase64: string): unknown {
  const key = parseKey(keyBase64);
  const envelope = JSON.parse(archive.toString("utf8")) as BackupEnvelope;
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("Unsupported backup envelope");
  }
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
