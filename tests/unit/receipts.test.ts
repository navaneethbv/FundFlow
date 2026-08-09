import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeReceiptImage } from "@/lib/receipt-image";
import { findReceiptCandidates } from "@/lib/receipts";

describe("findReceiptCandidates", () => {
  const transactions = [
    { id: "b", date: "2026-08-06", amount: 49.5, merchantName: "Corner Coffee Shop", name: "CORNER COFFEE" },
    { id: "a", date: "2026-08-09", amount: 50, merchantName: "Unrelated Market", name: "MARKET" },
    { id: "c", date: "2026-08-12", amount: 50.5, merchantName: "Corner Coffee", name: "COFFEE" },
    { id: "outside-date", date: "2026-08-13", amount: 50, merchantName: "Corner Coffee", name: "COFFEE" },
    { id: "outside-amount", date: "2026-08-09", amount: 50.51, merchantName: "Corner Coffee", name: "COFFEE" },
  ];

  it("includes exact and one-percent amount matches at three-day boundaries", () => {
    const result = findReceiptCandidates({ merchant: "Corner Coffee", total: 50, purchaseDate: "2026-08-09" }, transactions);

    expect(result.map((candidate) => candidate.transactionId).sort()).toEqual(["a", "b", "c"]);
  });

  it("uses merchant similarity for ranking and transaction id for deterministic ties", () => {
    const result = findReceiptCandidates(
      { merchant: "Corner Coffee", total: 50, purchaseDate: "2026-08-09" },
      [
        { id: "z", date: "2026-08-09", amount: 50, merchantName: "Corner Coffee", name: null },
        { id: "a", date: "2026-08-09", amount: 50, merchantName: "Corner Coffee", name: null },
        { id: "other", date: "2026-08-09", amount: 50, merchantName: "Grocery", name: null },
      ],
    );

    expect(result.map((candidate) => candidate.transactionId)).toEqual(["a", "z", "other"]);
  });

  it("returns no candidates for zero totals or invalid dates", () => {
    expect(findReceiptCandidates({ merchant: "Cafe", total: 0, purchaseDate: "2026-08-09" }, transactions)).toEqual([]);
    expect(findReceiptCandidates({ merchant: "Cafe", total: 50, purchaseDate: "unknown" }, transactions)).toEqual([]);
  });
});

describe("normalizeReceiptImage", () => {
  async function image(format: "jpeg" | "png" | "webp" | "gif", withMetadata = false) {
    let pipeline = sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 220, g: 230, b: 240 },
      },
    });
    if (withMetadata) pipeline = pipeline.withMetadata({ orientation: 6 });
    const buffer = await pipeline.toFormat(format).toBuffer();
    const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    return new File([buffer], `receipt.${format}`, { type: mime });
  }

  it.each(["jpeg", "png", "webp", "gif"] as const)(
    "decodes %s and emits a stripped normalized JPEG",
    async (format) => {
      const normalized = await normalizeReceiptImage(await image(format, true));
      const metadata = await sharp(normalized.buffer).metadata();

      expect(normalized.contentType).toBe("image/jpeg");
      expect(normalized.extension).toBe("jpg");
      expect(metadata.format).toBe("jpeg");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    },
  );

  it("rejects a declared MIME type that does not match the decoded format", async () => {
    const png = await image("png");
    const mismatched = new File([await png.arrayBuffer()], "receipt.jpg", { type: "image/jpeg" });

    await expect(normalizeReceiptImage(mismatched)).rejects.toThrow("image_type_mismatch");
  });

  it("rejects malformed bytes and files over five megabytes", async () => {
    await expect(
      normalizeReceiptImage(new File([new Uint8Array([1, 2, 3])], "bad.png", { type: "image/png" })),
    ).rejects.toThrow("invalid_image");
    await expect(
      normalizeReceiptImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" })),
    ).rejects.toThrow("image_too_large");
  });
});
