import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

let enabled = false;
let tokenScopes: string[] = ["mcp:aggregates"];
let serviceClient = clientStub();
const mockVerify = vi.fn(async (_header: string | null, scope: string) =>
  tokenScopes.includes(scope) ? { userId: "u1", scopes: tokenScopes } : null,
);
const mockLoadProjection = vi.fn();
const mockFetchRows = vi.fn();
const mockRateLimit = vi.fn().mockResolvedValue(true);
const mockAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => enabled }));
vi.mock("@/lib/api-tokens", () => ({ verifyApiToken: (...args: unknown[]) => mockVerify(...(args as [string | null, string])) }));
vi.mock("@/lib/finance-query", () => ({ loadCanonicalProjection: (...args: unknown[]) => mockLoadProjection(...args) }));
vi.mock("@/lib/export", () => ({ fetchPrivacySafeRows: (...args: unknown[]) => mockFetchRows(...args) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => mockRateLimit(...args) }));
vi.mock("@/lib/audit", () => ({ getClientIp: () => "127.0.0.1", writeAudit: (...args: unknown[]) => mockAudit(...args) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => serviceClient }));

import { GET, POST } from "@/app/api/mcp/route";

beforeEach(() => {
  vi.clearAllMocks();
  enabled = false;
  tokenScopes = ["mcp:aggregates"];
  serviceClient = clientStub({
    budgets: { data: [{ category: "Food", monthly_limit: 200 }] },
    recurring_streams: { data: [] },
    manual_recurring_items: { data: [] },
    net_worth_snapshots: { data: [{ snapshot_month: "2026-01-01", assets: 100, liabilities: 20 }] },
  });
  mockLoadProjection.mockResolvedValue({
    transactions: [
      { date: "2026-01-10", signedAmount: 10, flow: "expense", categoryKey: "Food" },
      { date: "2026-01-11", signedAmount: 20, flow: "expense", categoryKey: "Food" },
      { date: "2026-01-12", signedAmount: 30, flow: "expense", categoryKey: "Food" },
    ],
  });
  mockFetchRows.mockResolvedValue({ allowed: true, rows: [{ date: "2026-01-01", merchant: "Merchant", amount: 10, category: "Food" }] });
});

describe("/api/mcp", () => {
  it("is unavailable while the endpoint flag is off", async () => {
    const response = await GET(new NextRequest("http://localhost/api/mcp"));
    expect(response.status).toBe(404);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("requires the aggregate scope and returns projections without row fields", async () => {
    enabled = true;
    const response = await GET(new NextRequest("http://localhost/api/mcp?start=2026-01-01&end=2026-03-31", {
      headers: { authorization: "Bearer fft_token" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resource).toBe("aggregates");
    expect(body.monthlyCategories[0]).toMatchObject({ category: "Food", transactionCount: 3 });
    expect(JSON.stringify(body)).not.toContain("Merchant");
    expect(mockVerify).toHaveBeenCalledWith("Bearer fft_token", "mcp:aggregates");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "mcp_aggregate_read" }));
  });

  it("keeps export rows as a separately granted scope", async () => {
    enabled = true;
    tokenScopes = ["mcp:aggregates"];
    const refused = await POST(new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer fft_token", "content-type": "application/json" },
      body: JSON.stringify({ resource: "rows", start: "2026-01-01", end: "2026-01-31" }),
    }));
    expect(refused.status).toBe(401);

    tokenScopes = ["mcp:export-rows"];
    const allowed = await POST(new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer fft_token", "content-type": "application/json" },
      body: JSON.stringify({ resource: "rows", start: "2026-01-01", end: "2026-01-31" }),
    }));
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ resource: "rows", rows: [{ merchant: "Merchant" }] });
    expect(mockVerify).toHaveBeenLastCalledWith("Bearer fft_token", "mcp:export-rows");
  });

  it("rejects invalid and overlong ranges before token use", async () => {
    enabled = true;
    const response = await GET(new NextRequest("http://localhost/api/mcp?start=2026-01-01&end=2027-01-03"));
    expect(response.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("validates resources, dates, ordering, and category length", async () => {
    enabled = true;
    for (const query of [
      "?resource=unknown",
      "?start=2026-02-30&end=2026-03-01",
      "?start=2026-03-01&end=2026-02-01",
      `?start=2026-01-01&end=2026-03-31&category=${"x".repeat(81)}`,
    ]) {
      expect((await GET(new NextRequest(`http://localhost/api/mcp${query}`))).status).toBe(400);
    }
  });

  it("rejects malformed POST bodies before authentication", async () => {
    enabled = true;
    const invalidJson = await POST(new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: "not-json",
    }));
    expect(invalidJson.status).toBe(400);
    const arrayBody = await POST(new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify([]),
    }));
    expect(arrayBody.status).toBe(400);
  });

  it("enforces IP and user rate limits and fails closed on token lookup errors", async () => {
    enabled = true;
    mockRateLimit.mockResolvedValueOnce(false);
    expect((await GET(new NextRequest("http://localhost/api/mcp", { headers: { authorization: "Bearer x" } }))).status).toBe(429);

    mockRateLimit.mockResolvedValue(true);
    mockRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await GET(new NextRequest("http://localhost/api/mcp", { headers: { authorization: "Bearer x" } }))).status).toBe(429);

    mockRateLimit.mockResolvedValue(true);
    mockVerify.mockRejectedValueOnce(new Error("token service down"));
    expect((await GET(new NextRequest("http://localhost/api/mcp", { headers: { authorization: "Bearer x" } }))).status).toBe(503);
  });

  it("filters export rows and honors the export opt-out", async () => {
    enabled = true;
    tokenScopes = ["mcp:export-rows"];
    mockFetchRows.mockResolvedValue({ allowed: true, rows: [
      { date: "2026-01-01", merchant: "Food shop", amount: 10, category: "Food" },
      { date: "2026-01-02", merchant: "Transit", amount: 5, category: "TRANSPORT" },
    ] });
    const filtered = await GET(new NextRequest("http://localhost/api/mcp?resource=rows&category=food", { headers: { authorization: "Bearer x" } }));
    await expect(filtered.json()).resolves.toMatchObject({ rows: [{ merchant: "Food shop" }] });

    mockFetchRows.mockResolvedValue({ allowed: false });
    const denied = await GET(new NextRequest("http://localhost/api/mcp?resource=rows", { headers: { authorization: "Bearer x" } }));
    expect(denied.status).toBe(403);
  });

  it("returns explicit errors for projection and export failures", async () => {
    enabled = true;
    mockLoadProjection.mockRejectedValueOnce(new Error("projection down"));
    expect((await GET(new NextRequest("http://localhost/api/mcp", { headers: { authorization: "Bearer x" } }))).status).toBe(500);

    tokenScopes = ["mcp:export-rows"];
    mockFetchRows.mockRejectedValueOnce(new Error("export down"));
    expect((await GET(new NextRequest("http://localhost/api/mcp?resource=rows", { headers: { authorization: "Bearer x" } }))).status).toBe(500);
  });

  it("includes recurring and snapshot rows in aggregate projections", async () => {
    enabled = true;
    serviceClient = clientStub({
      budgets: { data: [{ category: null, monthly_limit: null }] },
      recurring_streams: { data: [{ average_amount: null, last_amount: 25, frequency: "monthly", category: "Pay", stream_type: "inflow", is_active: true }] },
      manual_recurring_items: { data: [{ amount: 7, frequency: "weekly", category: null, item_type: "expense", enabled: true }] },
      net_worth_snapshots: { data: [{ snapshot_month: "2026-01-01", assets: "100", liabilities: "25" }] },
    });
    const response = await GET(new NextRequest("http://localhost/api/mcp?start=2026-01-01&end=2026-03-31", { headers: { authorization: "Bearer x" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      budgets: [{ category: "UNCATEGORIZED", monthlyLimit: 0 }],
      recurring: expect.arrayContaining([
        expect.objectContaining({ category: "Pay", kind: "income" }),
        expect.objectContaining({ category: "UNCATEGORIZED", kind: "expense" }),
      ]),
    });
  });

  it("returns 500 when an aggregate dependency query fails", async () => {
    enabled = true;
    serviceClient = clientStub({ budgets: { data: [], error: { message: "budgets down" } } });
    expect((await GET(new NextRequest("http://localhost/api/mcp", { headers: { authorization: "Bearer x" } }))).status).toBe(500);
  });
});
