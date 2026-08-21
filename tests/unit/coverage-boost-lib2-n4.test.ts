import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import { loadReceiptCandidates, publicReceipt, loadReceiptInbox, type ReceiptRow } from "@/lib/receipt-data";
import { getRecentTransactions } from "@/lib/recent-transactions";
import { loadReportData, resolveReportScope, loadSavedReports } from "@/lib/reports-data";

const sharpMock = vi.hoisted(() => ({
  metadata: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("sharp", () => {
  return {
    __esModule: true,
    default: () => {
      const chain = {
        metadata: () => sharpMock.metadata(),
        rotate: () => chain,
        flatten: () => chain,
        jpeg: () => chain,
        toBuffer: (opts?: unknown) => sharpMock.toBuffer(opts),
      };
      return chain;
    },
  };
});

import { normalizeReceiptImage } from "@/lib/receipt-image";

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

function serviceStub(signed: { data?: unknown; error?: unknown } = {}) {
  return {
    ...clientStub(),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve(signed) }) },
  };
}

describe("receipt-data", () => {
  it("publicReceipt maps a null total to null", () => {
    expect(publicReceipt({ ...sampleReceipt, total: null }, "img", []).total).toBeNull();
    expect(publicReceipt(sampleReceipt, "img", []).total).toBe(25.5);
  });

  it("loadReceiptCandidates returns [] for a null data page", async () => {
    const supabase = clientStub({ transactions: { data: null } });
    expect(await loadReceiptCandidates(supabase as unknown as SupabaseClient, "u1", sampleReceipt)).toEqual([]);
  });

  it("loadReceiptInbox handles matched status and a signed-url error", async () => {
    const supabase = clientStub({
      receipts: {
        data: [
          { ...sampleReceipt, id: "r-matched", status: "matched" },
          { ...sampleReceipt, id: "r-ignored", status: "ignored" },
        ],
      },
    });
    const service = serviceStub({ data: null, error: { message: "no url" } });
    const inbox = await loadReceiptInbox(supabase as unknown as SupabaseClient, service as never, "u1");
    expect(inbox).toHaveLength(2);
    expect(inbox.every((row) => row.imageUrl === null)).toBe(true);
  });

  it("loadReceiptInbox degrades a failing signed-url call to a row with no image", async () => {
    const supabase = clientStub({
      receipts: { data: [{ ...sampleReceipt, status: "matched" }] },
    });
    const service = {
      ...clientStub(),
      storage: { from: () => ({ createSignedUrl: () => Promise.reject(new Error("boom")) }) },
    };
    const inbox = await loadReceiptInbox(supabase as unknown as SupabaseClient, service as never, "u1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.imageUrl).toBeNull();
  });

  it("loadReceiptInbox returns an empty list when the receipts query has no data", async () => {
    const supabase = clientStub({ receipts: { data: null } });
    const inbox = await loadReceiptInbox(supabase as unknown as SupabaseClient, serviceStub() as never, "u1");
    expect(inbox).toEqual([]);
  });

  it("loadReceiptInbox loads candidates for an unmatched receipt with a signed url", async () => {
    const supabase = clientStub({
      receipts: { data: [sampleReceipt] },
      transactions: { data: [{ id: "t1", date: "2026-08-09", amount: 25.5, merchant_name: "Cafe", name: "CAFE" }] },
    });
    const service = serviceStub({ data: { signedUrl: "https://signed/r1.jpg" }, error: null });
    const inbox = await loadReceiptInbox(supabase as unknown as SupabaseClient, service as never, "u1");
    expect(inbox[0]!.imageUrl).toBe("https://signed/r1.jpg");
    expect(inbox[0]!.candidates).toHaveLength(1);
  });
});

describe("recent-transactions", () => {
  it("covers a December month crossing into the next year", async () => {
    const supabase = clientStub({ transactions: { data: null } });
    const rows = await getRecentTransactions({ supabase: supabase as unknown as SupabaseClient, month: "2026-12" });
    expect(rows).toEqual([]);
    const calls = supabase.callsOn("transactions");
    expect(calls.some((c) => c.method === "lt" && c.args[1] === "2027-01-01")).toBe(true);
  });

  it("covers a non-December month plus user and account scoping", async () => {
    const supabase = clientStub({ transactions: { data: [] } });
    const rows = await getRecentTransactions({
      supabase: supabase as unknown as SupabaseClient,
      month: "2026-07",
      userId: "u1",
      accountId: "a1",
    });
    expect(rows).toEqual([]);
    expect(supabase.scopedToUser("transactions", "u1")).toBe(true);
  });
});

describe("reports-data", () => {
  it("resolveReportScope resolves visible household ids with data", async () => {
    const supabase = clientStub({ households: { data: [{ id: "hh1" }] } });
    const result = await resolveReportScope(supabase as unknown as SupabaseClient, "u1", "mine");
    expect(result.visibleHouseholdIds).toEqual(["hh1"]);
  });

  it("resolveReportScope handles a null data page", async () => {
    const supabase = clientStub({ households: { data: null } });
    const result = await resolveReportScope(supabase as unknown as SupabaseClient, "u1", "household:hh1");
    expect(result.visibleHouseholdIds).toEqual([]);
  });

  it("resolveReportScope throws when the households query errors", async () => {
    const supabase = clientStub({ households: { error: { message: "hh boom" } } });
    await expect(resolveReportScope(supabase as unknown as SupabaseClient, "u1", "mine")).rejects.toMatchObject({ message: "hh boom" });
  });

  it("loadSavedReports maps rows and handles a null data page", async () => {
    const supabase = clientStub({
      saved_reports: { data: [{ id: "s1", name: "Weekly", report_type: "spending", filters: {} }] },
    });
    const reports = await loadSavedReports(supabase as unknown as SupabaseClient, "u1");
    expect(reports).toHaveLength(1);
    const empty = clientStub({ saved_reports: { data: null } });
    expect(await loadSavedReports(empty as unknown as SupabaseClient, "u1")).toEqual([]);
  });

  it("loadReportData wires filters into the canonical projection", async () => {
    const supabase = clientStub();
    const result = await loadReportData(supabase as unknown as SupabaseClient, {
      scope: { kind: "mine", userId: "u1" } as never,
      filters: {
        start: "2026-07-01",
        end: "2026-07-31",
        excludePending: false,
        accounts: [],
        merchants: [],
        categories: [],
      } as never,
    });
    expect(result.transactions).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("receipt-image", () => {
  beforeEach(() => {
    sharpMock.metadata.mockReset();
    sharpMock.toBuffer.mockReset();
  });

  it("rejects an unsupported declared MIME type before decoding", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.bmp", { type: "image/bmp" });
    await expect(normalizeReceiptImage(file)).rejects.toThrow("unsupported_image_type");
  });

  it("rejects when the decoded format does not match the declared MIME type", async () => {
    sharpMock.metadata.mockResolvedValue({ format: "png" });
    const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });
    await expect(normalizeReceiptImage(file)).rejects.toThrow("image_type_mismatch");
  });

  it("throws invalid_image when the metadata read fails", async () => {
    sharpMock.metadata.mockRejectedValue(new Error("bad"));
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    await expect(normalizeReceiptImage(file)).rejects.toThrow("invalid_image");
  });

  it("throws invalid_image when the JPEG pipeline fails after metadata succeeds", async () => {
    sharpMock.metadata.mockResolvedValue({ format: "png" });
    sharpMock.toBuffer.mockRejectedValue(new Error("encode fail"));
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    await expect(normalizeReceiptImage(file)).rejects.toThrow("invalid_image");
  });

  it("returns a normalized jpeg buffer on success", async () => {
    sharpMock.metadata.mockResolvedValue({ format: "jpeg" });
    sharpMock.toBuffer.mockResolvedValue({ data: Buffer.from([1, 2, 3]), info: { width: 12, height: 8 } });
    const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });
    const normalized = await normalizeReceiptImage(file);
    expect(normalized.contentType).toBe("image/jpeg");
    expect(normalized.extension).toBe("jpg");
    expect(normalized.width).toBe(12);
    expect(normalized.height).toBe(8);
  });
});
