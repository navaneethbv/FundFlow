import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/accounts/reconcile/route";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";

const { readRpc, writeRpc } = vi.hoisted(() => ({ readRpc: vi.fn(), writeRpc: vi.fn() }));
vi.mock("@/lib/http", async (original) => ({ ...await original<typeof import("@/lib/http")>(), requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: writeRpc }) }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: vi.fn() }));
const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const TXN = "22222222-2222-2222-2222-222222222222";
const BODY = { account: `manual:${ACCOUNT}`, statement_date: "2026-08-31", statement_balance: 900,
  opening_date: "2026-07-31", opening_balance: 1000, request_id: "33333333-3333-3333-3333-333333333333",
  revision: "a".repeat(32), cleared_ids: [TXN], create_adjustment: false };
function get(query: object = {}) {
  return new NextRequest(`http://localhost/api/accounts/reconcile?${new URLSearchParams({ account: BODY.account, statement_date: BODY.statement_date, ...query })}`);
}
function post(changes: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/accounts/reconcile", { method: "POST", body: JSON.stringify({ ...BODY, ...changes }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "owner" }, supabase: { rpc: readRpc } } as never);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  readRpc.mockResolvedValue({ data: { needsOpeningBalance: true }, error: null });
  writeRpc.mockResolvedValue({ data: { ok: true, difference: 0, adjustment_amount: 0 }, error: null });
});
describe("reconciliation routes", () => {
  it.each([GET, POST])("requires authentication", async (handler) => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireUser).mockResolvedValue(denied);
    expect(await handler(handler === GET ? get() : post())).toBe(denied);
    expect(readRpc).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("reads the preview using the caller's RLS session", async () => {
    expect((await GET(get())).status).toBe(200);
    expect(readRpc).toHaveBeenCalledWith("get_reconciliation_preview", { p_source: "manual", p_account_id: ACCOUNT,
      p_statement_date: BODY.statement_date, p_opening_date: null, p_opening_balance: null });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("passes an explicit signed opening balance", async () => {
    const res = await GET(get({ account: `plaid:${ACCOUNT}`, opening_date: "2026-07-31", opening_balance: "-50.25" }));
    expect(res.status).toBe(200);
    expect(readRpc).toHaveBeenCalledWith("get_reconciliation_preview", expect.objectContaining({ p_source: "plaid", p_opening_balance: -50.25 }));
  });
  it.each([
    { account: "bad" }, { account: "manual:bad" }, { statement_date: "2026-02-30" }, { statement_date: "no" },
    { opening_date: "2026-07-31" }, { opening_balance: "10" },
    { opening_date: "wrong", opening_balance: "10" }, { opening_date: "2026-07-31", opening_balance: "Infinity" },
  ])("rejects malformed preview input %j", async (query) => {
    expect((await GET(get(query))).status).toBe(400); expect(readRpc).not.toHaveBeenCalled();
  });
  it("makes one atomic save with server-derived ownership", async () => {
    expect((await POST(post({ user_id: "attacker" }))).status).toBe(200);
    expect(writeRpc).toHaveBeenCalledTimes(1);
    expect(writeRpc).toHaveBeenCalledWith("save_reconciliation_atomic", expect.objectContaining({ p_user_id: "owner",
      p_account_id: ACCOUNT, p_cleared_ids: [TXN], p_request_id: BODY.request_id, p_revision: BODY.revision,
      p_statement_balance: 900, p_opening_balance: 1000, p_create_adjustment: false }));
    expect(invalidateDashboardCache).toHaveBeenCalledWith("owner"); expect(writeAudit).toHaveBeenCalledTimes(1);
  });
  it("rate limits writes before starting the transaction", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await POST(post())).status).toBe(429); expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each([
    { account: null }, { statement_date: null }, { statement_date: "2026-02-30" }, { statement_balance: "900" },
    { statement_balance: 1e15 }, { opening_date: "invalid" }, { opening_balance: "1000" },
    { opening_date: null }, { opening_balance: null }, { request_id: null }, { request_id: "bad" },
    { revision: null }, { revision: "bad" }, { cleared_ids: null }, { cleared_ids: [1] }, { cleared_ids: ["bad"] },
    { cleared_ids: Array(10001).fill(TXN) }, { create_adjustment: null },
  ])("rejects invalid saves before writing %j", async (changes) => {
    expect((await POST(post(changes))).status).toBe(400); expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each(["null", "invalid JSON"])("rejects malformed JSON %s", async (body) => {
    expect((await POST(new NextRequest("http://localhost/api/accounts/reconcile", { method: "POST", body }))).status).toBe(400);
  });
  it.each(["40001", "22023", "XX000"])("propagates database failures without claiming success: %s", async (code) => {
    readRpc.mockResolvedValue({ data: null, error: { code, message: "Preview changed" } });
    writeRpc.mockResolvedValue({ data: null, error: { code, message: "Preview changed" } });
    const status = code === "40001" ? 409 : code === "22023" ? 400 : 500;
    expect((await GET(get())).status).toBe(status); expect((await POST(post())).status).toBe(status);
    expect(writeAudit).not.toHaveBeenCalled(); expect(invalidateDashboardCache).not.toHaveBeenCalled();
  });
  it("fails closed when either RPC has no result", async () => {
    readRpc.mockResolvedValue({ data: null, error: null }); writeRpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(get())).status).toBe(500); expect((await POST(post())).status).toBe(500);
  });
});
