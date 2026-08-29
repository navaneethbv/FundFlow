import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE, PATCH, POST, MAX_SAVED_REPORTS } from "@/app/api/reports/saved/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { REPORT_FILTERS_VERSION, type ReportFilters } from "@/lib/reports";
import { clientStub, queryStub, type QueryResult } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => null) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const REPORT_ID = "123e4567-e89b-12d3-a456-426614174000";

const filters: ReportFilters = {
  version: REPORT_FILTERS_VERSION,
  start: "2026-07-01",
  end: "2026-07-31",
  tab: "cash_flow",
  mode: "breakdown",
  dimension: "category",
  scope: null,
  accounts: [],
  merchants: [],
  categories: [],
  excludePending: false,
  sort: "date",
  direction: "desc",
};

function req(method: string, body: unknown, url = "http://localhost/api/reports/saved") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

/** A client whose successive `from()` calls resolve differently, for routes
 *  that query one table twice (the cap count, then the write). */
function sequencedClient(results: QueryResult[]) {
  const stubs = results.map((result) => queryStub(result));
  let index = 0;
  return {
    from: vi.fn(() => stubs[Math.min(index++, stubs.length - 1)]!),
    stubs,
  };
}

describe("saved reports route", () => {
  let client: ReturnType<typeof clientStub>;

  function authWith(supabase: unknown) {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: supabase as never,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    client = clientStub({
      saved_reports: { count: 0, data: { id: REPORT_ID, name: "July", report_type: "cash_flow", filters } },
    });
    authWith(client);
  });

  describe("POST", () => {
    it("rejects a blank or missing name", async () => {
      expect((await POST(req("POST", { reportType: "cash_flow", filters }))).status).toBe(400);
      expect(
        (await POST(req("POST", { name: "   ", reportType: "cash_flow", filters }))).status,
      ).toBe(400);
    });

    it("rejects a name over 80 characters", async () => {
      const response = await POST(
        req("POST", { name: "x".repeat(81), reportType: "cash_flow", filters }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects an unknown report type", async () => {
      const response = await POST(
        req("POST", { name: "July", reportType: "everything", filters }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects filters that do not match the versioned schema", async () => {
      const response = await POST(
        req("POST", {
          name: "July",
          reportType: "cash_flow",
          filters: { ...filters, version: 99 },
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("schema"),
      });
    });

    it("rejects a body that is not JSON at all", async () => {
      const response = await POST(req("POST", "not json"));
      expect(response.status).toBe(400);
    });

    it("saves the report scoped to the caller and audits it", async () => {
      const response = await POST(req("POST", { name: "July", reportType: "cash_flow", filters }));
      expect(response.status).toBe(200);

      const written = client.writtenTo("saved_reports") as Record<string, unknown>;
      expect(written.user_id).toBe("user-1");
      expect(written.name).toBe("July");
      expect(written.report_type).toBe("cash_flow");
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "saved_report_created" }),
      );
    });

    it("trims the name before storing it", async () => {
      await POST(req("POST", { name: "  July  ", reportType: "cash_flow", filters }));
      const written = client.writtenTo("saved_reports") as Record<string, unknown>;
      expect(written.name).toBe("July");
    });

    it("409s once the per-user cap is reached", async () => {
      client = clientStub({ saved_reports: { count: MAX_SAVED_REPORTS } });
      authWith(client);
      const response = await POST(req("POST", { name: "July", reportType: "cash_flow", filters }));
      expect(response.status).toBe(409);
    });

    it("409s a duplicate name instead of surfacing a database error", async () => {
      const sequenced = sequencedClient([
        { count: 0 },
        { error: { code: "23505" } },
      ]);
      authWith(sequenced);
      const response = await POST(req("POST", { name: "July", reportType: "cash_flow", filters }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("already have"),
      });
    });

    it("429s when the rate limit is spent", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue(false);
      const response = await POST(req("POST", { name: "July", reportType: "cash_flow", filters }));
      expect(response.status).toBe(429);
    });

    it("passes the 401 straight through when unauthenticated", async () => {
      vi.mocked(requireUser).mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const response = await POST(req("POST", { name: "July", reportType: "cash_flow", filters }));
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH", () => {
    it("requires an id", async () => {
      expect((await PATCH(req("PATCH", { name: "New" }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: "  ", name: "New" }))).status).toBe(400);
    });

    it("rejects an empty patch", async () => {
      expect((await PATCH(req("PATCH", { id: REPORT_ID }))).status).toBe(400);
    });

    it("rejects an invalid new name or filter payload", async () => {
      expect(
        (await PATCH(req("PATCH", { id: REPORT_ID, name: "" }))).status,
      ).toBe(400);
      expect(
        (await PATCH(req("PATCH", { id: REPORT_ID, filters: { nope: true } }))).status,
      ).toBe(400);
    });

    it("renames scoped to the owner and audits the rename", async () => {
      const response = await PATCH(req("PATCH", { id: REPORT_ID, name: "August" }));
      expect(response.status).toBe(200);
      expect(client.scopedToUser("saved_reports", "user-1")).toBe(true);
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "saved_report_updated",
          metadata: { renamed: true },
        }),
      );
    });

    it("updates filters without a rename", async () => {
      const response = await PATCH(req("PATCH", { id: REPORT_ID, filters }));
      expect(response.status).toBe(200);
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { renamed: false } }),
      );
    });

    it("404s when the owner filter matches no row", async () => {
      client = clientStub({ saved_reports: { data: null } });
      authWith(client);
      const response = await PATCH(req("PATCH", { id: REPORT_ID, name: "August" }));
      expect(response.status).toBe(404);
    });

    it("409s a rename that collides with an existing name", async () => {
      client = clientStub({ saved_reports: { error: { code: "23505" } } });
      authWith(client);
      const response = await PATCH(req("PATCH", { id: REPORT_ID, name: "July" }));
      expect(response.status).toBe(409);
    });

    it("429s when the rate limit is spent", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue(false);
      expect((await PATCH(req("PATCH", { id: REPORT_ID, name: "A" }))).status).toBe(429);
    });
  });

  describe("DELETE", () => {
    // DELETE reads `nextUrl.searchParams`, so it needs a real NextRequest.
    function deleteReq(query: string) {
      return new NextRequest(`http://localhost/api/reports/saved${query}`, {
        method: "DELETE",
      });
    }

    it("requires an id", async () => {
      expect((await DELETE(deleteReq(""))).status).toBe(400);
    });

    it("deletes scoped to the owner and audits it", async () => {
      const response = await DELETE(deleteReq(`?id=${REPORT_ID}`));
      expect(response.status).toBe(200);
      expect(client.scopedToUser("saved_reports", "user-1")).toBe(true);
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "saved_report_deleted" }),
      );
    });

    it("404s when the row is not the caller's", async () => {
      client = clientStub({ saved_reports: { data: null } });
      authWith(client);
      const response = await DELETE(deleteReq(`?id=${REPORT_ID}`));
      expect(response.status).toBe(404);
    });
  });
});
