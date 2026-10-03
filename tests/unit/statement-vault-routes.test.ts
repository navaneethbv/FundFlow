import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mocks = vi.hoisted(() => ({
  enabled: true,
  allowed: true,
  requireUser: vi.fn(),
  writeAudit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  service: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mocks.requireUser(),
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => mocks.allowed }));
vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: (...args: unknown[]) => mocks.writeAudit(...args),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => mocks.service }));

import { GET, POST } from "@/app/api/statements/route";
import { DELETE } from "@/app/api/statements/[id]/route";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const STATEMENT_ID = "33333333-3333-4333-8333-333333333333";
const STATEMENT = {
  id: STATEMENT_ID,
  account_id: ACCOUNT_ID,
  manual_account_id: null,
  statement_month: "2026-09-01",
  storage_path: `${USER_ID}/account/${ACCOUNT_ID}/2026-09-01/${STATEMENT_ID}.pdf`,
  original_filename: "September.pdf",
  content_type: "application/pdf",
  size_bytes: 128,
  created_at: "2026-10-03T00:00:00.000Z",
};

let authSupabase = clientStub();
let serviceDb = clientStub();

function makeService() {
  return {
    ...serviceDb,
    storage: {
      from: vi.fn(() => ({ upload: mocks.upload, remove: mocks.remove })),
    },
  };
}

function fileRequest(file = new File(["%PDF-statement"], "September.pdf", { type: "application/pdf" }), changes: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file);
  form.set("account", changes.account ?? `account:${ACCOUNT_ID}`);
  form.set("month", changes.month ?? "2026-09-01");
  return new NextRequest("http://localhost/api/statements", { method: "POST", body: form });
}

const context = { params: Promise.resolve({ id: STATEMENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.allowed = true;
  authSupabase = clientStub({
    accounts: { data: { id: ACCOUNT_ID } },
    account_statements: { data: [STATEMENT] },
  });
  serviceDb = clientStub({ account_statements: { data: STATEMENT } });
  mocks.service = makeService();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
});

describe("statement vault route gates", () => {
  it("keeps every route unavailable while the flag is off", async () => {
    mocks.enabled = false;
    expect((await POST(fileRequest())).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost/api/statements"))).status).toBe(404);
    expect((await DELETE(new NextRequest("http://localhost/api/statements/id", { method: "DELETE" }), context)).status).toBe(404);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("returns the authentication response unchanged", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mocks.requireUser.mockResolvedValue(denied);
    expect(await POST(fileRequest())).toBe(denied);
    expect(await GET(new NextRequest("http://localhost/api/statements"))).toBe(denied);
    expect(await DELETE(new NextRequest("http://localhost/api/statements/id", { method: "DELETE" }), context)).toBe(denied);
  });
});

describe("POST /api/statements", () => {
  it("rate limits before parsing a file", async () => {
    mocks.allowed = false;
    expect((await POST(fileRequest())).status).toBe(429);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects malformed fields, non-PDF content, and unknown accounts", async () => {
    expect((await POST(fileRequest(new File(["text"], "statement.pdf", { type: "application/pdf" })))).status).toBe(400);
    expect((await POST(fileRequest(undefined, { month: "2026-09-02" }))).status).toBe(400);
    expect((await POST(fileRequest(undefined, { account: "account:not-a-uuid" }))).status).toBe(400);
    authSupabase = clientStub({ accounts: { data: null } });
    mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
    expect((await POST(fileRequest())).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("uploads owned PDFs, inserts metadata, and audits without exposing storage paths", async () => {
    const response = await POST(fileRequest());
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.statement).toMatchObject({
      id: STATEMENT_ID,
      account: `account:${ACCOUNT_ID}`,
      month: "2026-09-01",
      filename: "September.pdf",
    });
    expect(payload.statement.storagePath).toBeUndefined();
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${USER_ID}/account/${ACCOUNT_ID}/2026-09-01/`)), expect.any(Uint8Array), { contentType: "application/pdf", upsert: false });
    expect(serviceDb.writtenTo("account_statements")).toMatchObject({ user_id: USER_ID, account_id: ACCOUNT_ID, statement_month: "2026-09-01" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "statement_uploaded", metadata: expect.objectContaining({ statement_id: expect.any(String) }) }));
  });

  it("cleans up storage when metadata insertion fails and hides failures", async () => {
    serviceDb = clientStub({ account_statements: { data: null, error: new Error("insert failed") } });
    mocks.service = makeService();
    const response = await POST(fileRequest());
    expect(response.status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${USER_ID}/`))]);
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("GET /api/statements", () => {
  it("lists metadata and applies account and month filters", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/statements?account=account:${ACCOUNT_ID}&month=2026-09-01`));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.statements[0]).toMatchObject({ id: STATEMENT_ID, account: `account:${ACCOUNT_ID}`, month: "2026-09-01" });
    expect(payload.statements[0].storagePath).toBeUndefined();
    expect(authSupabase.callsOn("account_statements")).toEqual(expect.arrayContaining([
      { method: "eq", args: ["account_id", ACCOUNT_ID] },
      { method: "eq", args: ["statement_month", "2026-09-01"] },
    ]));
  });

  it("rejects invalid filters and query failures", async () => {
    expect((await GET(new NextRequest("http://localhost/api/statements?account=bad"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/statements?month=2026-09-02"))).status).toBe(400);
    authSupabase = clientStub({ account_statements: { data: null, error: new Error("list failed") } });
    mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
    expect((await GET(new NextRequest("http://localhost/api/statements"))).status).toBe(500);
  });
});

describe("DELETE /api/statements/:id", () => {
  it("removes the owned object and row and audits the id", async () => {
    authSupabase = clientStub({ account_statements: { data: STATEMENT } });
    mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
    const response = await DELETE(new NextRequest("http://localhost/api/statements/id", { method: "DELETE" }), context);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([STATEMENT.storage_path]);
    expect(serviceDb.callsOn("account_statements")).toEqual(expect.arrayContaining([
      { method: "eq", args: ["id", STATEMENT_ID] },
      { method: "eq", args: ["user_id", USER_ID] },
    ]));
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "statement_deleted", metadata: { statement_id: STATEMENT_ID } }));
  });

  it("does not touch storage when the row is not owned and maps storage failures", async () => {
    authSupabase = clientStub({ account_statements: { data: null } });
    mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
    expect((await DELETE(new NextRequest("http://localhost/api/statements/id", { method: "DELETE" }), context)).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
    authSupabase = clientStub({ account_statements: { data: STATEMENT } });
    mocks.requireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: authSupabase });
    mocks.remove.mockResolvedValue({ error: new Error("storage unavailable") });
    expect((await DELETE(new NextRequest("http://localhost/api/statements/id", { method: "DELETE" }), context)).status).toBe(500);
  });
});
