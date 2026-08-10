#!/usr/bin/env node
/**
 * Decrypt and inspect a FundFlow encrypted backup (2.1).
 *
 *   BACKUP_ENC_KEY=<base64 key> node scripts/restore-backup.mjs fundflow-backup-2026-07-23.json.enc > restored.json
 *
 * The output is the full takeout JSON. Restoring into a fresh Supabase
 * project means applying the migrations, then re-importing transactions
 * via Settings → Import (the JSON rows are import-compatible) — see
 * docs/CHANGES-roadmap-2026-07-23.md for the runbook.
 */
import { createDecipheriv, hkdfSync } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const KDF_INFO = "fundflow-backup-v1";

export function restoreBackup(file, key) {
  if (!file || !key) {
    throw new Error("Usage: BACKUP_ENC_KEY=<base64> node scripts/restore-backup.mjs <backup-file>");
  }

  const keyBuffer = Buffer.from(key, "base64");
  if (keyBuffer.length !== 32) {
    throw new Error("BACKUP_ENC_KEY must be 32 bytes base64.");
  }

  const backupPath = resolve(file);
  if (!statSync(backupPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Not a readable file: ${backupPath}`);
  }

  const envelope = JSON.parse(readFileSync(backupPath, "utf8"));
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("Unsupported backup envelope.");
  }

  // Per-user archives (kdf field) derive the AES key from BACKUP_ENC_KEY +
  // the envelope's user id; older archives decrypt with the raw key.
  const decipherKey =
    envelope.kdf === "hkdf-sha256-v1" && envelope.user_id
      ? hkdfSync(
          "sha256",
          keyBuffer,
          Buffer.from(envelope.user_id, "utf8"),
          Buffer.from(KDF_INFO, "utf8"),
          32,
        )
      : keyBuffer;

  const decipher = createDecipheriv(
    "aes-256-gcm",
    decipherKey,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return gunzipSync(compressed).toString("utf8");
}

export function runCli(argv = process.argv, env = process.env) {
  try {
    const file = argv[2];
    const key = env.BACKUP_ENC_KEY;
    const output = restoreBackup(file, key);
    process.stdout.write(output);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
