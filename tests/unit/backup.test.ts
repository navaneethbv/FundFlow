import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildBackupArchive, readBackupArchive } from "@/lib/backup";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

describe("backup archive", () => {
  const payload = {
    exported_at: "2026-07-23",
    transactions: [{ date: "2026-07-01", merchant: "Coffee", amount: 4.5 }],
  };

  it("round-trips a payload through gzip + AES-256-GCM", () => {
    const archive = buildBackupArchive(payload, KEY);
    expect(readBackupArchive(archive, KEY)).toEqual(payload);
  });

  it("produces a versioned envelope, not raw JSON", () => {
    const archive = buildBackupArchive(payload, KEY);
    const envelope = JSON.parse(archive.toString("utf8"));
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe("aes-256-gcm");
    expect(archive.toString("utf8")).not.toContain("Coffee");
  });

  it("rejects the wrong key and tampered ciphertext", () => {
    const archive = buildBackupArchive(payload, KEY);
    expect(() => readBackupArchive(archive, OTHER_KEY)).toThrow();

    const envelope = JSON.parse(archive.toString("utf8"));
    const data = Buffer.from(envelope.data, "base64");
    data[0] = data[0]! ^ 0xff;
    envelope.data = data.toString("base64");
    const tampered = Buffer.from(JSON.stringify(envelope), "utf8");
    expect(() => readBackupArchive(tampered, KEY)).toThrow();
  });
});
