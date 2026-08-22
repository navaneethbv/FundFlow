import { describe, expect, it, vi } from "vitest";
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCipheriv, randomBytes, hkdfSync } from "node:crypto";

import { restoreBackup } from "@/scripts/restore-backup.mjs";

const tmpDir = resolve("tmp");

if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

const KDF_INFO = "fundflow-backup-v1";

interface EnvelopeOptions {
  key: Buffer;
  kdf?: string;
  userId?: string;
  payload: unknown;
}

function buildEnvelope({
  key,
  kdf,
  userId,
  payload,
}: EnvelopeOptions): Record<string, string | number> {
  const derived =
    kdf === "hkdf-sha256-v1" && userId
      ? hkdfSync(
          "sha256",
          key,
          Buffer.from(userId, "utf8"),
          Buffer.from(KDF_INFO, "utf8"),
          32,
        )
      : key;
  const iv = randomBytes(12);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const envelope: Record<string, string | number> = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  if (kdf) envelope.kdf = kdf;
  if (userId) envelope.user_id = userId;
  return envelope;
}

function writeFixture(name: string, envelope: Record<string, string | number>): string {
  const filePath = join(tmpDir, name);
  writeFileSync(filePath, JSON.stringify(envelope), "utf8");
  return filePath;
}

function cleanup(...paths: string[]): void {
  for (const filePath of paths) {
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}

describe("scripts/restore-backup.mjs deep branches", () => {
  it("decrypts a per-user (hkdf) archive and a kdf-without-user archive", () => {
    const rawKey = randomBytes(32);
    const encKey = rawKey.toString("base64");

    const hkdfFile = writeFixture(
      "coverage-restore-hkdf.json.enc",
      buildEnvelope({
        key: rawKey,
        kdf: "hkdf-sha256-v1",
        userId: "user-123",
        payload: { scope: "per-user" },
      }),
    );
    const kdfNoUserFile = writeFixture(
      "coverage-restore-kdf-nouser.json.enc",
      buildEnvelope({
        key: rawKey,
        kdf: "hkdf-sha256-v1",
        payload: { scope: "raw-key" },
      }),
    );
    try {
      expect(JSON.parse(restoreBackup(hkdfFile, encKey))).toEqual({
        scope: "per-user",
      });
      expect(JSON.parse(restoreBackup(kdfNoUserFile, encKey))).toEqual({
        scope: "raw-key",
      });
    } finally {
      cleanup(hkdfFile, kdfNoUserFile);
    }
  });

  it("runs the CLI when the module is executed as the main entry", async () => {
    const rawKey = randomBytes(32);
    const encKey = rawKey.toString("base64");
    const fixture = writeFixture(
      "coverage-restore-main.json.enc",
      buildEnvelope({
        key: rawKey,
        payload: { main: true },
      }),
    );

    const moduleUrl = new URL("../../scripts/restore-backup.mjs", import.meta.url);
    const modulePath = fileURLToPath(moduleUrl);
    const origArgv = process.argv.slice();
    const origEnv = process.env.BACKUP_ENC_KEY;

    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      process.env.BACKUP_ENC_KEY = encKey;
      process.argv = [origArgv[0]!, modulePath, fixture];
      vi.resetModules();
      await import(moduleUrl.href);
      expect(
        stdoutWrite.mock.calls.some(([chunk]) =>
          String(chunk).includes('"main":true'),
        ),
      ).toBe(true);
    } finally {
      stdoutWrite.mockRestore();
      process.argv = origArgv;
      if (origEnv === undefined) {
        delete process.env.BACKUP_ENC_KEY;
      } else {
        process.env.BACKUP_ENC_KEY = origEnv;
      }
      cleanup(fixture);
    }
  });
});
