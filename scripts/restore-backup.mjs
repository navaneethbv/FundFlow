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
import { createDecipheriv } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
const key = process.env.BACKUP_ENC_KEY;
if (!file || !key) {
  console.error("Usage: BACKUP_ENC_KEY=<base64> node scripts/restore-backup.mjs <backup-file>");
  process.exit(1);
}

const keyBuffer = Buffer.from(key, "base64");
if (keyBuffer.length !== 32) {
  console.error("BACKUP_ENC_KEY must be 32 bytes base64.");
  process.exit(1);
}

// This is an operator-run CLI: reading a path the operator names is the whole
// point, and it grants no access their own shell does not already have. Still,
// resolve it and insist on a regular file so a typo or a directory fails with a
// clear message instead of an opaque read error.
const backupPath = resolve(file);
if (!statSync(backupPath, { throwIfNoEntry: false })?.isFile()) {
  console.error(`Not a readable file: ${backupPath}`);
  process.exit(1);
}

const envelope = JSON.parse(readFileSync(backupPath, "utf8"));
if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
  console.error("Unsupported backup envelope.");
  process.exit(1);
}

const decipher = createDecipheriv(
  "aes-256-gcm",
  keyBuffer,
  Buffer.from(envelope.iv, "base64"),
);
decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const compressed = Buffer.concat([
  decipher.update(Buffer.from(envelope.data, "base64")),
  decipher.final(),
]);
process.stdout.write(gunzipSync(compressed).toString("utf8"));
