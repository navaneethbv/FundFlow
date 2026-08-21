import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "@/tests/fixtures/supabase-query";

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

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSavedReportCreated = vi.fn<(...args: unknown[]) => unknown>();
const mockSavedReportUpdated = vi.fn<(...args: unknown[]) => unknown>();
const mockSavedReportDeleted = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/request-audit", () => ({
  requestAudits: {
    savedReportCreated: (...args: unknown[]) => mockSavedReportCreated(...args),
    savedReportUpdated: (...args: unknown[]) => mockSavedReportUpdated(...args),
    savedReportDeleted: (...args: unknown[]) => mockSavedReportDeleted(...args),
  },
}));

const VALID_FILTERS = {
  version: 1,
  start: "2026-01-01",
  end: "2026-12-31",
  tab: "cash_flow",
  mode: "breakdown",
  dimension: "category",
  scope: null,
  accounts: [],
  merchants: [],
  categories: [],
  excludePending: false,
};
const mockParseReportFilters = vi.fn<(...args: unknown[]) => unknown>((input: unknown) =>
  input === VALID_FILTERS ? VALID_FILTERS : null,
);
vi.mock("@/lib/reports", () => ({
  parseReportFilters: (...args: unknown[]) => mockParseReportFilters(...args),
  REPORT_TABS: ["cash_flow", "spending", "income"],
}));

import {
  POST as reportsPost,
  PATCH as reportsPatch,
  DELETE as reportsDelete,
} from "@/app/api/reports/saved/route";

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

function deleteRequest(query: string) {
  return {
    url: `https://x.local${query}`,
    nextUrl: new URL(`https://x.local${query}`),
  } as unknown as NextRequest;
}

const REPORT_ROW = { id: "r1", name: "My report", report_type: "cash_flow", filters: VALID_FILTERS };

function postSupabase(countResult: unknown, insertResult: unknown) {
  let calls = 0;
  const countChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => resolve(countResult),
  };
  const insertChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => resolve(insertResult),
  };
  return {
    from: vi.fn(() => {
      calls += 1;
      return calls === 1 ? countChain : insertChain;
    }),
  };
}

describe("coverage boost r6 n6: reports/saved route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  describe("POST /api/reports/saved", () => {
    it("returns 429 when rate limited (L42, L43, B@42)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await reportsPost(jsonRequest({}));
      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toEqual({ error: "Too many requests" });
    });

    it("rejects when json() rejects (L46 catch arrow, parseName L23, L53 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name is required (1-80 characters)");
    });

    it("rejects a blank name (parseName empty side)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(jsonRequest({ name: "   " }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name is required (1-80 characters)");
    });

    it("rejects an over-long name (parseName length side, B@25)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(jsonRequest({ name: "x".repeat(81) }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name is required (1-80 characters)");
    });

    it("rejects an invalid reportType (L54, L55 true, B@30)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "bogus" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("reportType must be cash_flow, spending, or income");
    });

    it("rejects a non-string reportType", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: 5 }));
      expect(res.status).toBe(400);
    });

    it("rejects invalid filters (L56, L57 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "cash_flow", filters: { bad: true } }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("filters did not match the saved-report schema");
    });

    it("creates a saved report (L53-92 happy path)", async () => {
      const supabase = clientStub({
        saved_reports: { data: REPORT_ROW, error: null, count: 5 },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(
        jsonRequest({ name: "My report", reportType: "spending", filters: VALID_FILTERS }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, report: REPORT_ROW });
      const written = supabase.writtenTo("saved_reports") as { user_id: string; report_type: string };
      expect(written.user_id).toBe("u1");
      expect(written.report_type).toBe("spending");
      expect(mockSavedReportCreated).toHaveBeenCalledWith(expect.any(Object), "u1", { report_type: "spending" });
    });

    it("treats a null count as 0 (L65 nullish side)", async () => {
      const supabase = clientStub({ saved_reports: { data: REPORT_ROW, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "income", filters: VALID_FILTERS }));
      expect(res.status).toBe(200);
    });

    it("returns 500 when the count query fails (L64 true)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: new Error("count boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "cash_flow", filters: VALID_FILTERS }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("reports.saved.post", expect.any(Error));
    });

    it("rejects when the user has hit the saved-report cap (L65 true, L66-69)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: null, count: 50 } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "cash_flow", filters: VALID_FILTERS }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        error: "You can save up to 50 reports. Delete one first.",
      });
    });

    it("maps a duplicate name to 409 (L82 true, L83-86)", async () => {
      const supabase = postSupabase(
        { data: null, error: null, count: 0 },
        { data: null, error: { code: "23505", message: "dup" } },
      );
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "cash_flow", filters: VALID_FILTERS }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        error: "You already have a saved report with that name.",
      });
    });

    it("returns 500 when the insert fails (L88 true)", async () => {
      const supabase = postSupabase(
        { data: null, error: null, count: 0 },
        { data: null, error: { code: "PGRST301", message: "boom" } },
      );
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPost(jsonRequest({ name: "My report", reportType: "cash_flow", filters: VALID_FILTERS }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("reports.saved.post", expect.any(Object));
    });
  });

  describe("PATCH /api/reports/saved", () => {
    it("returns 429 when rate limited (L98, L99, B@98)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await reportsPatch(jsonRequest({ id: "r1", name: "New" }));
      expect(res.status).toBe(429);
    });

    it("rejects when json() rejects (L102 catch arrow, L107 true, B@107)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPatch(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    });

    it("rejects a blank id", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPatch(jsonRequest({ id: "   " }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    });

    it("rejects when there is nothing to update (L111, L112/117 false, L122 true, L123)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPatch(jsonRequest({ id: "r1" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("nothing to update");
    });

    it("renames a report (L112 true, L114 false, L115, L133 false, L140 false, L148)", async () => {
      const supabase = clientStub({ saved_reports: { data: REPORT_ROW, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPatch(jsonRequest({ id: "r1", name: "Renamed report" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, report: REPORT_ROW });
      expect(supabase.writtenTo("saved_reports")).toEqual({ name: "Renamed report" });
      expect(mockSavedReportUpdated).toHaveBeenCalledWith(expect.any(Object), "u1", { renamed: true });
    });

    it("rejects an invalid replacement name (L114 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPatch(jsonRequest({ id: "r1", name: 123 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name must be 1-80 characters");
    });

    it("rejects invalid replacement filters (L117 true, L119 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsPatch(jsonRequest({ id: "r1", filters: { bad: true } }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("filters did not match the saved-report schema");
    });

    it("updates filters without renaming (L117 true, L119 false, renamed false)", async () => {
      const supabase = clientStub({ saved_reports: { data: REPORT_ROW, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPatch(jsonRequest({ id: "r1", filters: VALID_FILTERS }));
      expect(res.status).toBe(200);
      expect(supabase.writtenTo("saved_reports")).toEqual({ filters: VALID_FILTERS });
      expect(mockSavedReportUpdated).toHaveBeenCalledWith(expect.any(Object), "u1", { renamed: false });
    });

    it("maps a duplicate name to 409 (L133 true, L134-137)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: { code: "23505", message: "dup" } } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPatch(jsonRequest({ id: "r1", name: "Taken" }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        error: "You already have a saved report with that name.",
      });
    });

    it("returns 500 when the update fails (L139 true)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: new Error("update boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPatch(jsonRequest({ id: "r1", name: "New" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("reports.saved.patch", expect.any(Error));
    });

    it("returns 404 when the report does not exist (L140 true, L141)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsPatch(jsonRequest({ id: "r1", name: "New" }));
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Report not found" });
    });
  });

  describe("DELETE /api/reports/saved", () => {
    it("rejects a missing id (L154, L155 true, B@155)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await reportsDelete(deleteRequest(""));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("id is required");
    });

    it("deletes a saved report (L155 false, L164 false, L165 false, L169, L171)", async () => {
      const supabase = clientStub({ saved_reports: { data: { id: "r1" }, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsDelete(deleteRequest("?id=r1"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(mockSavedReportDeleted).toHaveBeenCalledWith(expect.any(Object), "u1", {});
    });

    it("returns 500 when the delete fails (L164 true)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: new Error("delete boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsDelete(deleteRequest("?id=r1"));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("reports.saved.delete", expect.any(Error));
    });

    it("returns 404 when the report does not exist (L165 true, L166)", async () => {
      const supabase = clientStub({ saved_reports: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await reportsDelete(deleteRequest("?id=r1"));
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Report not found" });
    });
  });
});