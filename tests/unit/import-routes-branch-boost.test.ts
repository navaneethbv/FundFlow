import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub, queryStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn((message: unknown) =>
  NextResponse.json({ error: String(message) }, { status: 400 }),
);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (context: unknown, error: unknown) => mockErrorResponse(context, error),
  badRequest: (message: unknown) => mockBadRequest(message),
}));

const mockDetectSourceFormat = vi.fn<(...args: unknown[]) => unknown>(() => "csv");
const mockGetCsvColumns = vi.fn<(...args: unknown[]) => unknown>();
const mockNormalizeColumnMap = vi.fn<(...args: unknown[]) => unknown>();
const mockParseImportCsv = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/import", () => ({
  detectSourceFormat: (...args: unknown[]) => mockDetectSourceFormat(...args),
  getCsvColumns: (...args: unknown[]) => mockGetCsvColumns(...args),
  normalizeColumnMap: (...args: unknown[]) => mockNormalizeColumnMap(...args),
  parseImportCsv: (...args: unknown[]) => mockParseImportCsv(...args),
  makeImportId: (accountId: string, row: { date: string; merchant: string }, occurrence: number) =>
    `import-${accountId}-${row.date}-${row.merchant}-${occurrence}`,
}));

const mockBuildImportReview = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/planning", () => ({
  buildImportReview: (...args: unknown[]) => mockBuildImportReview(...args),
}));

const mockParseOfx = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockParseMintCsv = vi.fn<(...args: unknown[]) => unknown>(() => ({ rows: [], errors: [] }));
const mockParseMonarchCsv = vi.fn<(...args: unknown[]) => unknown>(() => ({ rows: [], errors: [] }));
const mockParseYnabCsv = vi.fn<(...args: unknown[]) => unknown>(() => ({ rows: [], errors: [] }));

vi.mock("@/lib/import-ofx", () => ({ parseOfx: (...args: unknown[]) => mockParseOfx(...args) as unknown[] }));
vi.mock("@/lib/import-mint", () => ({ parseMintCsv: (...args: unknown[]) => mockParseMintCsv(...args) as { rows: unknown[]; errors: string[]; requiresDateOrder?: boolean } }));
vi.mock("@/lib/import-monarch", () => ({ parseMonarchCsv: (...args: unknown[]) => mockParseMonarchCsv(...args) as { rows: unknown[]; errors: string[]; requiresDateOrder?: boolean } }));
vi.mock("@/lib/import-ynab", () => ({ parseYnabCsv: (...args: unknown[]) => mockParseYnabCsv(...args) as { rows: unknown[]; errors: string[]; requiresDateOrder?: boolean } }));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args) }));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const mockRefreshInferredRecurringForUser = vi.fn();
vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForUser: (...args: unknown[]) => mockRefreshInferredRecurringForUser(...args),
}));

const mockCreateServiceClient = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

import { POST as previewPost } from "@/app/api/import/preview/route";
import { POST as commitPost } from "@/app/api/import/commit/route";

describe("Import API Branch Coverage Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockDetectSourceFormat.mockReturnValue("csv");
    mockParseImportCsv.mockReturnValue({ rows: [], errors: [] });
    mockBuildImportReview.mockReturnValue({ rows: [] });
  });

  describe("POST /api/import/preview extra branches", () => {
    it("returns 400 when column_map is invalid JSON", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });
      mockGetCsvColumns.mockReturnValue({ headers: ["date", "amount"], sample: ["2026-01-01", "10"] });

      const form = new FormData();
      const file = new File(["date,amount\n2026-01-01,10"], "statement.csv", { type: "text/csv" });
      form.append("file", file);
      form.append("column_map", "{invalid-json-mapping");

      const req = new NextRequest("http://localhost/api/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewPost(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Invalid column mapping. Map at least a date, description, and amount (or debit/credit).",
      );
    });

    it("parses with YNAB format when detected", async () => {
      mockDetectSourceFormat.mockReturnValue("ynab");
      mockParseYnabCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 25, category: "Groceries" }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "hash-1", row: { date: "2026-07-01", merchant: "Store", amount: 25 }, flags: [] }],
      });

      const userClient = clientStub({
        transactions: { data: [] },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const serviceClient = clientStub({
        import_review_batches: { data: { id: "batch-ynab-1" } },
        import_review_rows: {
          data: [{ id: "row-1", date: "2026-07-01", description: "Store", amount: 25, row_index: 0, status: "pending" }],
        },
      });
      mockCreateServiceClient.mockReturnValue(serviceClient);

      const form = new FormData();
      const file = new File(["Date,Payee,Amount"], "ynab.csv", { type: "text/csv" });
      form.append("file", file);
      form.append("date_order", "dmy");

      const req = new NextRequest("http://localhost/api/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewPost(req);
      expect(res.status).toBe(200);
      expect(mockParseYnabCsv).toHaveBeenCalledWith(expect.any(String), { dateOrder: "dmy", requireDateOrder: false });
    });

    it("returns needs_date_format when format parser requires date order", async () => {
      mockDetectSourceFormat.mockReturnValue("mint");
      mockParseMintCsv.mockReturnValue({
        rows: [],
        errors: ["Ambiguous date format: 01/02/2026"],
        requiresDateOrder: true,
      });

      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });

      const form = new FormData();
      const file = new File(["Date,Description,Amount"], "mint.csv", { type: "text/csv" });
      form.append("file", file);

      const req = new NextRequest("http://localhost/api/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.needs_date_format).toBe(true);
      expect(json.parse_errors).toEqual(["Ambiguous date format: 01/02/2026"]);
    });

    it("throws AggregateError when staging fails AND batch deletion fails", async () => {
      mockDetectSourceFormat.mockReturnValue("csv");
      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "h1", row: { date: "2026-07-01", merchant: "Store", amount: 10 }, flags: [] }],
      });

      const userClient = clientStub({ transactions: { data: [] } });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const serviceClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            const stub = queryStub({ data: { id: "batch-err-1" } });
            stub.delete = () => {
              const deleteStub = queryStub({ data: null, error: new Error("cleanup delete failed") });
              return deleteStub;
            };
            return stub;
          }
          if (table === "import_review_rows") {
            return queryStub({ data: null, error: new Error("staging insert failed") });
          }
          return queryStub({ data: null });
        }),
      };
      mockCreateServiceClient.mockReturnValue(serviceClient);

      const form = new FormData();
      const file = new File(["date,desc,amount"], "statement.csv", { type: "text/csv" });
      form.append("file", file);

      const req = new NextRequest("http://localhost/api/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewPost(req);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("import.preview", expect.any(AggregateError));
    });

    it("surfaces source accounts with both account_id and manual_account_id mapped", async () => {
      mockDetectSourceFormat.mockReturnValue("csv");
      mockParseImportCsv.mockReturnValue({
        rows: [
          { date: "2026-07-01", merchant: "Store 1", amount: 10, sourceAccount: "Checking 1" },
          { date: "2026-07-02", merchant: "Store 2", amount: 20, sourceAccount: "Wallet 2" },
        ],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [
          { rowHash: "h1", row: { date: "2026-07-01", merchant: "Store 1", amount: 10, sourceAccount: "Checking 1" }, flags: [] },
          { rowHash: "h2", row: { date: "2026-07-02", merchant: "Store 2", amount: 20, sourceAccount: "Wallet 2" }, flags: [] },
        ],
      });

      const userClient = clientStub({
        transactions: { data: [] },
        import_source_account_mappings: {
          data: [
            { source_account: "Checking 1", account_id: "acc-100", manual_account_id: null },
            { source_account: "Wallet 2", account_id: null, manual_account_id: "man-200" },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const serviceClient = clientStub({
        import_review_batches: { data: { id: "batch-src-1" } },
        import_review_rows: {
          data: [
            { id: "row-1", date: "2026-07-01", description: "Store 1", amount: 10, source_account: "Checking 1", row_index: 0, status: "pending" },
            { id: "row-2", date: "2026-07-02", description: "Store 2", amount: 20, source_account: "Wallet 2", row_index: 1, status: "pending" },
          ],
        },
      });
      mockCreateServiceClient.mockReturnValue(serviceClient);

      const form = new FormData();
      const file = new File(["date,desc,amount,acc"], "statement.csv", { type: "text/csv" });
      form.append("file", file);

      const req = new NextRequest("http://localhost/api/import/preview", {
        method: "POST",
        body: form,
      });

      const res = await previewPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.source_accounts).toEqual(["Checking 1", "Wallet 2"]);
      expect(json.source_account_mappings).toEqual({
        "Checking 1": { account_id: "acc-100" },
        "Wallet 2": { manual_account_id: "man-200" },
      });
    });
  });

  describe("POST /api/import/commit extra branches", () => {
    it("returns 429 when commit rate limit is hit", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });
      mockCheckRateLimit.mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b1", account_id: "acc-1" }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(429);
    });

    it("returns 400 when missing required batch_id or account target", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ account_id: "acc-1" }), // missing batch_id
      });

      const res = await commitPost(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("batch_id and account_id are required");
    });

    it("returns 404 when batch is not found", async () => {
      const userClient = clientStub({
        import_review_batches: { data: null },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b-none", account_id: "acc-1" }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Import batch not found");
    });

    it("returns 404 when default manual account is not found", async () => {
      const userClient = clientStub({
        import_review_batches: { data: { id: "b1", created_at: new Date().toISOString() } },
        manual_accounts: { data: null }, // not found
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b1", manual_account_id: "man-unowned" }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Manual account not found");
    });

    it("returns 400 when multiple source accounts have unmapped sources", async () => {
      const userClient = clientStub({
        import_review_batches: { data: { id: "b1", created_at: new Date().toISOString() } },
        accounts: { data: { id: "acc-1" } },
        import_review_rows: {
          data: [
            { id: "r1", date: "2026-07-01", description: "Row 1", amount: 10, source_account: "Source A", status: "pending" },
            { id: "r2", date: "2026-07-02", description: "Row 2", amount: 20, source_account: "Source B", status: "pending" },
          ],
        },
        import_source_account_mappings: { data: [] },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b1",
          account_id: "acc-1",
          account_mappings: { "Source A": { account_id: "acc-1" } }, // missing Source B
        }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith('Choose a FundFlow account for source account "Source B"');
    });

    it("returns 400 when mapped manual account target is not available", async () => {
      const userClient = clientStub({
        import_review_batches: { data: { id: "b1", created_at: new Date().toISOString() } },
        accounts: { data: { id: "acc-1" } },
        import_review_rows: {
          data: [
            { id: "r1", date: "2026-07-01", description: "Row 1", amount: 10, source_account: "Source Manual", status: "pending" },
          ],
        },
        import_source_account_mappings: { data: [] },
        manual_accounts: { data: [] }, // man-target not in DB
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b1",
          account_id: "acc-1",
          account_mappings: { "Source Manual": { manual_account_id: "man-target" } },
        }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("One or more mapped manual accounts are not available");
    });

    it("returns 409 when newer FundFlow edits conflict with import notes/tags", async () => {
      const batchCreatedAt = "2026-07-01T10:00:00Z";
      const userClient = clientStub({
        import_review_batches: { data: { id: "b1", created_at: batchCreatedAt } },
        accounts: { data: { id: "acc-1" } },
        import_review_rows: {
          data: [
            {
              id: "r1",
              date: "2026-07-01",
              description: "Item with note",
              amount: 50,
              source_account: null,
              notes: "Imported note",
              tags: ["tag1"],
              status: "pending",
            },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      // Service client returns an existing transaction and a newer conflicting annotation
      const serviceClient = clientStub({
        transactions: {
          data: [
            { id: "txn-101", plaid_transaction_id: "import-acc-1-2026-07-01-Item with note-0" },
          ],
        },
        transaction_annotations: {
          data: [
            {
              transaction_id: "txn-101",
              updated_at: "2026-07-01T12:00:00Z", // newer than batchCreatedAt
              note: "FundFlow in-app edit", // different from Imported note
              tags: [],
            },
          ],
        },
      });
      mockCreateServiceClient.mockReturnValue(serviceClient);

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b1", account_id: "acc-1" }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.conflicts).toEqual(["r1"]);
    });

    it("handles recurring inference failure gracefully after commit", async () => {
      const userClient = clientStub({
        import_review_batches: { data: [{ id: "b1", created_at: new Date().toISOString() }] },
        accounts: { data: [{ id: "acc-1" }] },
        import_review_rows: {
          data: [
            { id: "r1", date: "2026-07-01", description: "Row 1", amount: 10, source_account: null, status: "pending" },
          ],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: userClient });

      const serviceClient = clientStub({
        transactions: { data: [] },
        transaction_annotations: { data: [] },
        import_review_rows: { data: [{ id: "r1" }] },
        import_review_batches: { data: [{ id: "b1" }] },
      });
      mockCreateServiceClient.mockReturnValue(serviceClient);
      mockRefreshInferredRecurringForUser.mockRejectedValue(new Error("recurring refresh crashed"));

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b1", account_id: "acc-1" }),
      });

      const res = await commitPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imported).toBe(1);
    });
  });
});
