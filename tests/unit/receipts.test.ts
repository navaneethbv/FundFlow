import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeReceiptImage } from "@/lib/receipt-image";
import { findReceiptCandidates } from "@/lib/receipts";
import {
  loadReceiptCandidates,
  publicReceipt,
  loadReceiptInbox,
  type ReceiptRow,
} from "@/lib/receipt-data";

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
    expect(findReceiptCandidates({ merchant: "Cafe", total: 50, purchaseDate: "2026-02-31" }, transactions)).toEqual([]);
  });

  it("handles empty merchant tokens, null names, and invalid transaction dates/amounts", () => {
    const edgeTransactions = [
      { id: "tx-fallback-name", date: "2026-08-09", amount: 50, merchantName: null, name: "Fallback Name" },
      { id: "tx-fallback-unknown", date: "2026-08-09", amount: 50, merchantName: null, name: null },
      { id: "tx-invalid-date", date: "2026-02-31", amount: 50, merchantName: "Store", name: "Store" },
      { id: "tx-bad-amount", date: "2026-08-09", amount: NaN, merchantName: "Store", name: "Store" },
    ];

    const res = findReceiptCandidates(
      { merchant: "!!!", total: 50, purchaseDate: "2026-08-09" },
      edgeTransactions,
    );
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.merchant)).toEqual(["Fallback Name", "Unknown"]);
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

describe("loadReceiptCandidates & loadReceiptInbox & publicReceipt", () => {
  const sampleReceipt: ReceiptRow = {
    id: "r1",
    user_id: "u1",
    transaction_id: null,
    storage_path: "u1/r1.jpg",
    merchant: "Cafe",
    purchase_date: "2026-08-09",
    total: 25.5,
    status: "unmatched",
    created_at: "2026-08-09T10:00:00Z",
  };

  it("returns empty array when receipt is incomplete or total <= 0", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub();
    const incomplete = { ...sampleReceipt, merchant: null };
    expect(await loadReceiptCandidates(supabase as unknown as SupabaseClient, "u1", incomplete)).toEqual([]);
  });

  it("loads candidates for a valid receipt row", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub({
      transactions: {
        data: [{ id: "t1", date: "2026-08-09", amount: 25.5, merchant_name: "Cafe", name: "CAFE" }],
      },
    });
    const candidates = await loadReceiptCandidates(supabase as unknown as SupabaseClient, "u1", sampleReceipt);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].transactionId).toBe("t1");
  });

  it("throws when transactions query fails in loadReceiptCandidates", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub({
      transactions: { data: null, error: { message: "Query failed" } },
    });
    await expect(loadReceiptCandidates(supabase as unknown as SupabaseClient, "u1", sampleReceipt)).rejects.toMatchObject({
      message: "Query failed",
    });
  });

  it("formats a public receipt row using publicReceipt", () => {
    const publicRow = publicReceipt(sampleReceipt, "https://example.com/r1.jpg", []);
    expect(publicRow).toEqual({
      id: "r1",
      transaction_id: null,
      merchant: "Cafe",
      purchase_date: "2026-08-09",
      total: 25.5,
      status: "unmatched",
      created_at: "2026-08-09T10:00:00Z",
      imageUrl: "https://example.com/r1.jpg",
      candidates: [],
    });
  });

  it("loads receipt inbox items", async () => {
    const { clientStub } = await import("../fixtures/supabase-query");
    const supabase = clientStub({
      receipts: { data: [sampleReceipt] },
      transactions: { data: [] },
    });
    const service = {
      ...clientStub(),
      storage: {
        from: () => ({
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://signed.url/r1.jpg" }, error: null }),
        }),
      },
    };

    const inbox = await loadReceiptInbox(supabase as unknown as SupabaseClient, service as never, "u1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].imageUrl).toBe("https://signed.url/r1.jpg");
  });
});
