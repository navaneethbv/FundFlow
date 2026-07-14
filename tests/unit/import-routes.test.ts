import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => mockBadRequest(msg),
}));

const mockBuildImportReview = vi.fn();
vi.mock("@/lib/planning", () => ({
  buildImportReview: (...args: unknown[]) => mockBuildImportReview(...args),
}));

const mockParseImportCsv = vi.fn();
const mockMakeImportId = vi.fn(
  (accId, row, n) => `import-id-${accId}-${row.date}-${n}`,
);
const mockGetCsvColumns = vi.fn();
const mockNormalizeColumnMap = vi.fn();
vi.mock("@/lib/import", () => ({
  parseImportCsv: (...args: unknown[]) => mockParseImportCsv(...args),
  makeImportId: (...args: unknown[]) => mockMakeImportId(...args),
  getCsvColumns: (...args: unknown[]) => mockGetCsvColumns(...args),
  normalizeColumnMap: (...args: unknown[]) => mockNormalizeColumnMap(...args),
}));

const mockCheckRateLimit = vi.fn(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn();
const mockGetClientIp = vi.fn(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { POST as previewPost } from "@/app/api/import/preview/route";
import { POST as commitPost } from "@/app/api/import/commit/route";
import { POST as csvPost } from "@/app/api/import/csv/route";
import { NextResponse, NextRequest } from "next/server";

describe("Import API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/import/preview", () => {
    it("returns bad request if form data parsing fails", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const request = {
        formData: () => Promise.reject(new Error("Form fail")),
      } as unknown as NextRequest;
      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Expected multipart form data");
    });

    it("returns bad request if file is missing", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const formData = new FormData();
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;
      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("file is required");
    });

    it("returns needs_mapping if parsing yields 0 rows but headers exist", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["col1,col2"], "empty.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({ rows: [], errors: ["No rows"] });
      mockGetCsvColumns.mockReturnValue({
        headers: ["col1", "col2"],
        sample: ["val1", "val2"],
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        needs_mapping: true,
        headers: ["col1", "col2"],
        sample: ["val1", "val2"],
        parse_errors: ["No rows"],
      });
    });

    it("previews statement rows, saves batch, and returns preview rows", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", {
        type: "text/csv",
      });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("column_map", "{}");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockGetCsvColumns.mockReturnValue({
        headers: ["a", "b"],
        sample: ["1", "2"],
      });
      mockNormalizeColumnMap.mockReturnValue({
        date: 0,
        description: 1,
        amount: 2,
      });
      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [
          {
            rowHash: "h1",
            row: { date: "2026-07-01", merchant: "Store", amount: 10 },
            flags: [],
          },
        ],
      });

      const singleMock = vi
        .fn()
        .mockResolvedValue({ data: { id: "batch-1" }, error: null });
      const batchChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: singleMock,
      };
      const rowsChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: [
            {
              id: "row-1",
              date: "2026-07-01",
              description: "Store",
              amount: 10,
              status: "pending",
            },
          ],
          error: null,
        }),
      };
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") return batchChain;
        if (table === "import_review_rows") return rowsChain;
        return null as never;
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        batch_id: "batch-1",
        rows: [
          {
            id: "row-1",
            date: "2026-07-01",
            description: "Store",
            amount: 10,
            status: "pending",
            flags: [],
          },
        ],
        parse_errors: [],
      });
    });
  });

  describe("POST /api/import/commit", () => {
    it("returns bad request if params are invalid", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const request = {
        json: () => Promise.resolve({}),
      } as unknown as NextRequest;
      const res = await commitPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "batch_id and account_id are required",
      );
    });

    it("returns 404 if account not found", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const request = {
        json: () => Promise.resolve({ batch_id: "b1", account_id: "a1" }),
      } as unknown as NextRequest;

      const res = await commitPost(request);
      expect(res.status).toBe(404);
    });

    it("commits approved rows and updates status successfully", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table) => {
          if (table === "accounts") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "row-1",
                    date: "2026-07-01",
                    description: "Store",
                    amount: 10,
                    status: "pending",
                  },
                ],
              }),
            };
          }
          return null as never;
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const request = {
        json: () =>
          Promise.resolve({
            batch_id: "b1",
            account_id: "a1",
            approved_row_ids: ["row-1"],
          }),
      } as unknown as NextRequest;

      const updateMock = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: updateMock,
            eq: updateMock,
          }),
        }),
      });

      const res = await commitPost(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, imported: 1 });
    });
  });

  describe("POST /api/import/csv", () => {
    it("returns 429 if rate limited", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      mockCheckRateLimit.mockResolvedValue(false);
      const request = {} as NextRequest;

      const res = await csvPost(request);
      expect(res.status).toBe(429);
    });

    it("returns bad request if file too large", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      mockCheckRateLimit.mockResolvedValue(true);
      const file = new File([""], "too-large.csv", { type: "text/csv" });
      Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("File too large (2 MB max)");
    });

    it("imports CSV records within pre-Plaid boundary and writes audit log", async () => {
      mockCheckRateLimit.mockResolvedValue(true);
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", {
        type: "text/csv",
      });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [
          {
            date: "2026-06-15",
            merchant: "Store",
            amount: 10,
            category: "Food",
          },
          {
            date: "2026-07-15",
            merchant: "Store2",
            amount: 20,
            category: "Shop",
          },
        ],
        errors: [],
      });

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { date: "2026-07-01" },
                  }),
                }),
              }),
            }),
          }),
        }),
      });
      mockServiceClient.from.mockReturnValue({
        select: selectMock,
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });

      const res = await csvPost(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        imported: 1,
        skipped_overlap: 1,
        parse_errors: [],
      });

      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          action: "data_import",
          metadata: expect.objectContaining({
            rows_imported: 1,
            rows_skipped_overlap: 1,
          }),
        }),
      );
    });
  });
});
