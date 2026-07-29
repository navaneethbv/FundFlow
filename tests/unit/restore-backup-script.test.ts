import { describe, it, expect, vi } from "vitest";
import { restoreBackup, runCli } from "@/scripts/restore-backup.mjs";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createCipheriv, randomBytes } from "node:crypto";

describe("scripts/restore-backup.mjs", () => {
  const tmpDir = resolve("tmp");

  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  it("throws error when file argument or key is missing", () => {
    expect(() => restoreBackup("", "")).toThrow("Usage: BACKUP_ENC_KEY=");
  });

  it("throws error when BACKUP_ENC_KEY length is invalid", () => {
    expect(() => restoreBackup("file.json", "invalid-short-key")).toThrow(
      "BACKUP_ENC_KEY must be 32 bytes base64.",
    );
  });

  it("throws error when file does not exist", () => {
    const rawKey = randomBytes(32).toString("base64");
    expect(() => restoreBackup("non-existent-file.json", rawKey)).toThrow(
      "Not a readable file:",
    );
  });

  it("throws error when envelope is unsupported", () => {
    const rawKey = randomBytes(32).toString("base64");
    const badFilePath = join(tmpDir, "bad-backup.json");
    writeFileSync(badFilePath, JSON.stringify({ v: 2, alg: "other" }), "utf8");

    try {
      expect(() => restoreBackup(badFilePath, rawKey)).toThrow(
        "Unsupported backup envelope.",
      );
    } finally {
      if (existsSync(badFilePath)) unlinkSync(badFilePath);
    }
  });

  it("decrypts and unzips a valid encrypted backup file", () => {
    const rawKey = randomBytes(32);
    const encKeyBase64 = rawKey.toString("base64");
    const iv = randomBytes(12);

    const originalText = JSON.stringify({ hello: "world", date: "2026-07-29" });
    const compressed = gzipSync(Buffer.from(originalText, "utf8"));

    const cipher = createCipheriv("aes-256-gcm", rawKey, iv);
    const encryptedData = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const envelope = {
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: authTag.toString("base64"),
      data: encryptedData.toString("base64"),
    };

    const backupFilePath = join(tmpDir, "test-backup.json.enc");
    writeFileSync(backupFilePath, JSON.stringify(envelope), "utf8");

    try {
      const output = restoreBackup(backupFilePath, encKeyBase64);
      expect(output).toBe(originalText);
    } finally {
      if (existsSync(backupFilePath)) {
        unlinkSync(backupFilePath);
      }
    }
  });

  it("runCli executes and handles errors via process.exit", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    runCli(["node", "script", ""], process.env);

    expect(mockConsoleError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});
