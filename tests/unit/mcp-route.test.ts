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
});
