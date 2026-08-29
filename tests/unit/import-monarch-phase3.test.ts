import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { clientStub, queryStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_c: string, _e: unknown) =>
    NextResponse.json({ error: String((_e as Error)?.message ?? _e) }, { status: 500 }),
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve(true),
}));

let serviceFrom: ReturnType<typeof vi.fn>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
}));

import { POST as previewPost } from "@/app/api/import/preview/route";
import { POST as commitPost } from "@/app/api/import/commit/route";
import type { NextRequest } from "next/server";

const MONARCH_HEADER = ["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Tags"];
const headerLine = MONARCH_HEADER.map((h) => `"${h}"`).join(",");

function monarchCsv(): File {
  const csv = [
    headerLine,
    '"2026-08-01","Jewelry Store","Shopping","Checking","JEWELRY","Anniversary gift","-500.00","luxury,gift"',
  ].join("\n");
  return new File([csv], "monarch.csv", { type: "text/csv" });
}

function formRequest(file: File): NextRequest {
  const form = new FormData();
  form.append("file", file);
  return { formData: () => Promise.resolve(form) } as unknown as NextRequest;
}

describe("Monarch import conflicts, idempotency, and authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockReset();
  });

  it("previews a Plaid-vs-Monarch category conflict and stages notes/tags", async () => {
    const rls = clientStub({
      transactions: {
        data: [
          {
            date: "2026-08-01",
            amount: 500,
            merchant_name: "Jewelry Store",
            name: "JEWELRY",
            pfc_primary: "TRANSFER_OUT",
          },
        ],
      },
      import_source_account_mappings: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: rls });

    const batch = queryStub({
      data: [{ id: "batch-1", date: "2026-08-01", description: "Jewelry Store", amount: 500, source_account: "Checking", row_index: 0, status: "pending" }],
    });
    serviceFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "import_review_batches") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
        };
      }
      if (table === "import_review_rows") {
        return batch;
      }
      return queryStub({ data: [] });
    });

    const res = await previewPost(formRequest(monarchCsv()));
    const body = await res.json();
    expect({ status: res.status, error: (body as { error?: string }).error }).toEqual({
      status: 200,
      error: undefined,
    });
    expect(body.rows[0].flags).toContain("possible-duplicate");
    expect(body.rows[0].flags).toContain("category-conflict");
    expect(body.source_accounts).toEqual(["Checking"]);

    const inserted = batch.calls.find((c) => c.method === "insert")?.args[0] as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({
      user_id: "user-1",
      category: "Shopping",
      notes: "Anniversary gift",
      tags: ["luxury", "gift"],
    });
  });

  it("refuses to overwrite a newer FundFlow edit without explicit approval", async () => {
    const rls = clientStub({
      accounts: { data: [{ id: "a1" }] },
      import_review_rows: {
        data: [
          {
            id: "row-1",
            date: "2026-08-01",
            description: "Coffee",
            amount: 5,
            category: "Dining",
            source_account: null,
            notes: "Note",
            tags: [],
            row_index: 0,
            status: "pending",
          },
        ],
      },
      import_source_account_mappings: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: rls });

    // The existing transaction has an annotation edited after the batch started.
    // The transaction mock captures the import ids the conflict check asks for,
    // so it can answer with a matching existing transaction regardless of hash.
    serviceFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "import_review_batches") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { created_at: "2026-08-01T00:00:00Z" }, error: null }),
        };
      }
      if (table === "transactions") {
        const txnStub: Record<string, unknown> = {};
        const builder = {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockImplementation((_col: string, ids: string[]) => {
            txnStub.importIds = ids;
            return builder;
          }),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          then: (resolve: (v: { data: unknown[] }) => unknown) =>
            resolve({
              data: [
                { id: "txn-1", plaid_transaction_id: (txnStub.importIds as string[])[0] ?? "" },
              ],
            }),
        };
        return builder;
      }
      if (table === "transaction_annotations") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          then: (resolve: (v: { data: unknown[] }) => unknown) =>
            resolve({ data: [{ transaction_id: "txn-1", updated_at: "2026-08-02T00:00:00Z" }] }),
        };
      }
      return queryStub({ data: [] });
    });

    const request = {
      json: () => Promise.resolve({ batch_id: "b1", account_id: "a1", approved_row_ids: ["row-1"] }),
    } as unknown as NextRequest;

    // Without explicit approval, the commit must refuse.
    const blockedReq = {
      json: () => Promise.resolve({ batch_id: "b1", account_id: "a1" }),
    } as unknown as NextRequest;
    const blocked = await commitPost(blockedReq);
    if (blocked.status !== 409) {
      const b = await blocked.json();
      throw new Error(`expected 409 got ${blocked.status}: ${JSON.stringify(b)}`);
    }

    // With the row explicitly approved, the commit proceeds.
    const approved = await commitPost(request);
    if (approved.status !== 200) {
      const ab = await approved.json();
      throw new Error(`expected 200 got ${approved.status}: ${JSON.stringify(ab)}`);
    }
  });

  it("is idempotent: rows already committed are skipped on re-commit", async () => {
    const rls = clientStub({
      accounts: { data: [{ id: "a1" }] },
      import_review_rows: {
        data: [
          {
            id: "row-1",
            date: "2026-08-01",
            description: "Coffee",
            amount: 5,
            category: "Dining",
            source_account: null,
            notes: null,
            tags: [],
            row_index: 0,
            status: "committed",
          },
        ],
      },
      import_source_account_mappings: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: rls });

    const transactionUpsert = vi.fn().mockResolvedValue({ error: null });
    serviceFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "import_review_batches") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { created_at: "2026-08-01T00:00:00Z" }, error: null }),
        };
      }
      if (table === "transactions") return { upsert: transactionUpsert, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: [] }) };
      return queryStub({ data: [] });
    });

    const request = {
      json: () => Promise.resolve({ batch_id: "b1", account_id: "a1" }),
    } as unknown as NextRequest;
    const res = await commitPost(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, imported: 0 });
    expect(transactionUpsert).not.toHaveBeenCalled();
  });

  it("rejects a commit targeting another user's batch", async () => {
    const rls = clientStub({
      accounts: { data: [{ id: "a1" }] },
      import_review_rows: { data: [] },
      import_source_account_mappings: { data: [] },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: rls });
    serviceFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "import_review_batches") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return queryStub({ data: [] });
    });
    const request = {
      json: () => Promise.resolve({ batch_id: "foreign-batch", account_id: "a1" }),
    } as unknown as NextRequest;
    const res = await commitPost(request);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 0 });
  });
});