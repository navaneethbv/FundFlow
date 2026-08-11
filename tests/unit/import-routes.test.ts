import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockBuildImportReview = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/planning", () => ({
  buildImportReview: (...args: unknown[]) => mockBuildImportReview(...args),
}));

const mockParseImportCsv = vi.fn<(...args: unknown[]) => unknown>();
const mockMakeImportId = vi.fn<(...args: unknown[]) => unknown>(
  (accId: unknown, row: unknown, n: unknown) => `import-id-${String(accId)}-${(row as { date: string }).date}-${String(n)}`,
);
const mockGetCsvColumns = vi.fn<(...args: unknown[]) => unknown>();
const mockNormalizeColumnMap = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/import", () => ({
  parseImportCsv: (...args: unknown[]) => mockParseImportCsv(...args),
  makeImportId: (...args: unknown[]) => mockMakeImportId(...args),
  getCsvColumns: (...args: unknown[]) => mockGetCsvColumns(...args),
  normalizeColumnMap: (...args: unknown[]) => mockNormalizeColumnMap(...args),
}));

const mockLooksLikeOfx = vi.fn<(...args: unknown[]) => boolean>();
const mockParseOfx = vi.fn<(...args: unknown[]) => unknown[]>();
vi.mock("@/lib/import-ofx", () => ({
  looksLikeOfx: (...args: unknown[]) => mockLooksLikeOfx(...args),
  parseOfx: (...args: unknown[]) => mockParseOfx(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
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
import { NextRequest, NextResponse } from "next/server";

describe("Import API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLooksLikeOfx.mockReturnValue(false);
    mockCheckRateLimit.mockResolvedValue(true);
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

    it("sends OFX rows through the existing staged review pipeline", async () => {
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
      const file = new File(["OFXHEADER:100\n<OFX>...</OFX>"], "checking.qfx", {
        type: "application/x-ofx",
      });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockLooksLikeOfx.mockReturnValue(true);
      mockParseOfx.mockReturnValue([
        {
          date: "2026-07-01",
          description: "Coffee shop",
          amount: 10.25,
          fitid: "fit-1",
        },
      ]);
      mockBuildImportReview.mockReturnValue({
        rows: [
          {
            rowHash: "h1",
            row: {
              date: "2026-07-01",
              merchant: "Coffee shop",
              amount: 10.25,
              category: null,
            },
            flags: [],
          },
        ],
      });

      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "batch-ofx" },
              error: null,
            }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: [
              {
                id: "row-ofx",
                date: "2026-07-01",
                description: "Coffee shop",
                amount: 10.25,
                status: "pending",
              },
            ],
            error: null,
          }),
        };
      });

      const res = await previewPost(request);

      expect(res.status).toBe(200);
      expect(mockParseImportCsv).not.toHaveBeenCalled();
      expect(mockGetCsvColumns).not.toHaveBeenCalled();
      expect(mockBuildImportReview).toHaveBeenCalledWith(
        [
          {
            date: "2026-07-01",
            merchant: "Coffee shop",
            amount: 10.25,
            category: null,
          },
        ],
        new Set(),
      );
      await expect(res.json()).resolves.toMatchObject({
        batch_id: "batch-ofx",
        rows: [{ id: "row-ofx", description: "Coffee shop" }],
      });
    });

    it("returns bad request when column map is invalid", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["col1,col2"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("column_map", "{}");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockGetCsvColumns.mockReturnValue({ headers: ["a", "b"], sample: ["1", "2"] });
      mockNormalizeColumnMap.mockReturnValue(null);

      const res = await previewPost(request);
      expect(res.status).toBe(400);
    });

    it("returns bad request when 0 rows parsed and no headers exist", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File([""], "empty.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({ rows: [], errors: ["No importable rows found"] });
      mockGetCsvColumns.mockReturnValue(null);

      const res = await previewPost(request);
      expect(res.status).toBe(400);
    });

    it("returns 500 when batch insert fails", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: mockSupabase });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "h1", row: { date: "2026-07-01", merchant: "Store", amount: 10 }, flags: [] }],
      });
      mockServiceClient.from.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "Batch Insert error" } }),
      });

      const res = await previewPost(request);
      expect(res.status).toBe(500);
    });

    it("returns the auth response when not signed in", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await previewPost({} as NextRequest);
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await previewPost({} as NextRequest);
      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toEqual({
        error: "Too many previews. Please wait a while.",
      });
    });

    it("returns bad request when the file is too large", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File([""], "big.csv", { type: "text/csv" });
      Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("File too large (2 MB max)");
    });

    it("returns bad request when the column map does not match any headers", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["col1,col2"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("column_map", "{}");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockGetCsvColumns.mockReturnValue(null);

      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Invalid column mapping. Map at least a date, description, and amount (or debit/credit).",
      );
    });

    it("returns bad request when the file has too many rows", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["data"], "huge.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: Array.from({ length: 20_001 }, (_, i) => ({
          date: "2026-07-01",
          merchant: `M${i}`,
          amount: 10,
        })),
        errors: [],
      });

      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Too many rows (20000 max per file)",
      );
    });

    it("falls back to the OFX message when an OFX file yields no rows", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["OFXHEADER:100"], "empty.qfx", {
        type: "application/x-ofx",
      });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockLooksLikeOfx.mockReturnValue(true);
      mockParseOfx.mockReturnValue([]);

      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "No importable OFX rows found",
      );
    });

    it("falls back to the CSV message when a mapped file yields no rows", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["col1,col2"], "empty.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("column_map", "{}");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockGetCsvColumns.mockReturnValue({ headers: ["a", "b"], sample: ["1", "2"] });
      mockNormalizeColumnMap.mockReturnValue({
        date: 0,
        description: 1,
        amount: 2,
      });
      mockParseImportCsv.mockReturnValue({ rows: [], errors: [] });

      const res = await previewPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "No importable rows found",
      );
    });

    it("fingerprints existing rows with missing merchant and name", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { date: "2026-07-01", amount: 10, merchant_name: "Store", name: "S" },
                { date: "2026-07-02", amount: 11, merchant_name: null, name: "PayPal" },
                { date: "2026-07-03", amount: 12, merchant_name: null, name: null },
              ],
            }),
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
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [
          {
            rowHash: "h1",
            row: { date: "2026-07-01", merchant: "Store", amount: 10 },
            flags: ["possible_duplicate"],
          },
        ],
      });
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: [
              { id: "row-1", date: "2026-07-01", description: "Store", amount: 10, status: "rejected" },
            ],
            error: null,
          }),
        };
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      expect(mockBuildImportReview).toHaveBeenCalledWith(
        expect.any(Array),
        new Set(["2026-07-01|10.00|Store", "2026-07-02|11.00|PayPal", "2026-07-03|12.00|"]),
      );
    });

    it("defaults the file name and rejects flagged rows", async () => {
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
      const file = new File(["2026-07-01,Store,10.00"], "", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [
          {
            rowHash: "h1",
            row: { date: "2026-07-01", merchant: "Store", amount: 10 },
            flags: ["possible_duplicate"],
          },
        ],
      });

      const insertMock = vi.fn().mockReturnValue({ file_name: "statement.csv" });
      const rowsChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: [
            { id: "row-1", date: "2026-07-01", description: "Store", amount: 10, status: "rejected" },
          ],
          error: null,
        }),
      };
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: (payload: unknown) => {
              insertMock(payload);
              return { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }) };
            },
          };
        }
        return rowsChain;
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rows).toEqual([
        { id: "row-1", date: "2026-07-01", description: "Store", amount: 10, status: "rejected", flags: ["possible_duplicate"] },
      ]);
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ file_name: "statement.csv" }),
      );
      expect(rowsChain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ status: "rejected" }),
        ]),
      );
    });

    it("returns 500 when inserting review rows fails", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: mockSupabase });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "h1", row: { date: "2026-07-01", merchant: "Store", amount: 10 }, flags: [] }],
      });
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: null, error: { message: "Rows error" } }),
        };
      });

      const res = await previewPost(request);
      expect(res.status).toBe(500);
    });

    it("returns empty rows when the insert returns no data", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: mockSupabase });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "h1", row: { date: "2026-07-01", merchant: "Store", amount: 10 }, flags: [] }],
      });
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ rows: [] });
    });

    it("falls back to an empty flag list for unmatched inserted rows", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: mockSupabase });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" });
      const formData = new FormData();
      formData.set("file", file);
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-07-01", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockBuildImportReview.mockReturnValue({
        rows: [{ rowHash: "h1", row: { date: "2026-07-01", merchant: "Store", amount: 10 }, flags: [] }],
      });
      mockServiceClient.from.mockImplementation((table) => {
        if (table === "import_review_batches") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: [
              { id: "row-1", date: "2026-07-01", description: "Store", amount: 10, status: "pending" },
              { id: "row-2", date: "2026-07-02", description: "Other", amount: 5, status: "pending" },
            ],
            error: null,
          }),
        };
      });

      const res = await previewPost(request);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        rows: [
          { id: "row-1", flags: [] },
          { id: "row-2", flags: [] },
        ],
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

    it("returns bad request when form data parsing fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const request = {
        formData: () => Promise.reject(new Error("Form fail")),
      } as unknown as NextRequest;

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Expected multipart form data",
      );
    });

    it("returns bad request when the file is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("file is required");
    });

    it("returns bad request when the account id is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" }));
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("account_id is required");
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

    it("imports OFX rows through the same pre-Plaid pipeline", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const file = new File(["OFXHEADER:100\n<OFX>...</OFX>"], "bank.ofx", {
        type: "application/x-ofx",
      });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockLooksLikeOfx.mockReturnValue(true);
      mockParseOfx.mockReturnValue([
        { date: "2026-06-15", description: "", amount: 100, fitid: "fit-1" },
        { date: "2026-07-15", description: "Salary", amount: -200, fitid: "fit-2" },
      ]);
      const boundary = {
        select: vi.fn().mockReturnValue({
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
        }),
      };
      const upsert = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") {
          return { select: boundary.select, upsert };
        }
        return null as never;
      });

      const res = await csvPost(request);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ok: true,
        imported: 1,
        skipped_overlap: 1,
        parse_errors: [],
      });
      expect(mockParseImportCsv).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "Imported" }),
        ]),
        expect.objectContaining({ onConflict: "plaid_transaction_id" }),
      );
    });

    it("imports every row when the boundary query finds no synced row", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const file = new File(["2026-06-15,Store,10.00"], "statement.csv", {
        type: "text/csv",
      });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-06-15", merchant: "Store", amount: 10 }],
        errors: [],
      });
      const boundary = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      const upsert = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") {
          return { select: boundary.select, upsert };
        }
        return null as never;
      });

      const res = await csvPost(request);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ok: true,
        imported: 1,
        skipped_overlap: 0,
        parse_errors: [],
      });
    });

    it("returns bad request when parse errors exist and no rows were parsed", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["bad"], "x.csv", { type: "text/csv" }));
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({ rows: [], errors: ["Line 1: malformed"] });

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Line 1: malformed");
    });

    it("falls back to the generic message when no rows parse without errors", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["bad"], "x.csv", { type: "text/csv" }));
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({ rows: [], errors: [] });

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("No importable rows found");
    });

    it("returns bad request when the file has too many rows", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["data"], "huge.csv", { type: "text/csv" }));
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: Array.from({ length: 20_001 }, (_, i) => ({
          date: "2026-07-01",
          merchant: `M${i}`,
          amount: 10,
        })),
        errors: [],
      });

      const res = await csvPost(request);
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "Too many rows (20000 max per file)",
      );
    });

    it("returns 500 when the boundary query fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["2026-06-15,Store,10.00"], "s.csv", { type: "text/csv" }));
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: [{ date: "2026-06-15", merchant: "Store", amount: 10 }],
        errors: [],
      });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  not: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: null,
                          error: { message: "boundary failed" },
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return null as never;
      });

      const res = await csvPost(request);
      expect(res.status).toBe(500);
    });

    it("returns 500 when the chunked upsert fails", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "a1" } }),
          }),
        },
      });
      const formData = new FormData();
      formData.set("file", new File(["data"], "big.csv", { type: "text/csv" }));
      formData.set("account_id", "a1");
      const request = {
        formData: () => Promise.resolve(formData),
      } as unknown as NextRequest;

      mockParseImportCsv.mockReturnValue({
        rows: Array.from({ length: 501 }, (_, i) => ({
          date: "2026-06-15",
          merchant: `M${i}`,
          amount: 10,
        })),
        errors: [],
      });
      const boundary = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      const upsert = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { message: "dup key" } });
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === "transactions") {
          return { select: boundary.select, upsert };
        }
        return null as never;
      });

      const res = await csvPost(request);
      expect(res.status).toBe(500);
    });

    it("returns 401 when requireUser fails or handles missing account / DB error in import csv route", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const unauthRes = await csvPost({} as NextRequest);
      expect(unauthRes.status).toBe(401);

      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const file = new File(["2026-07-01,Store,10.00"], "statement.csv", { type: "text/csv" });
      const formDataMissingAcc = new FormData();
      formDataMissingAcc.set("file", file);
      const resNoAcc = await csvPost({ formData: () => Promise.resolve(formDataMissingAcc) } as unknown as NextRequest);
      expect(resNoAcc.status).toBe(400);

      const formDataWithAcc = new FormData();
      formDataWithAcc.set("file", file);
      formDataWithAcc.set("account_id", "a1");
      const mockSupabaseNullAcc = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: mockSupabaseNullAcc });
      const resNullAcc = await csvPost({ formData: () => Promise.resolve(formDataWithAcc) } as unknown as NextRequest);
      expect(resNullAcc.status).toBe(404);
    });
  });
});
