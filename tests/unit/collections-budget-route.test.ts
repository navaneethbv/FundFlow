import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

let enabled = true;
let currentUser: { id: string } | null = { id: "user-1" };
let supabase = clientStub({});
const audit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (flag: string) => flag === "transactionCollections" && enabled }));
vi.mock("@/lib/audit", () => ({ writeAudit: audit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/http", () => ({
  requireUser: async () => currentUser ? { user: currentUser, supabase } : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
}));

import { PUT } from "@/app/api/collections/budget/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/collections/budget", { method: "PUT", body: JSON.stringify(body) });
}

describe("PUT /api/collections/budget", () => {
  beforeEach(() => {
    enabled = true;
    currentUser = { id: "user-1" };
    supabase = clientStub({ transaction_collections: { data: null } });
    vi.clearAllMocks();
  });

  it("saves an owner-scoped budget for a collection", async () => {
    const response = await PUT(request({ name: " Japan trip ", budget: 1500.5 }));
    expect(response.status).toBe(200);
    expect(supabase.writtenTo("transaction_collections")).toEqual({ user_id: "user-1", name: "Japan trip", budget: 1500.5 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "collection_budget_updated" }));
  });

  it("clears a budget with null, scoped to the owner", async () => {
    const response = await PUT(request({ name: "Japan trip", budget: null }));
    expect(response.status).toBe(200);
    expect(supabase.scopedToUser("transaction_collections", "user-1")).toBe(true);
  });

  it("is hidden when disabled and requires a user", async () => {
    enabled = false;
    expect((await PUT(request({ name: "x", budget: 1 }))).status).toBe(404);
    enabled = true;
    currentUser = null;
    expect((await PUT(request({ name: "x", budget: 1 }))).status).toBe(401);
  });

  it.each([
    [{ name: "", budget: 1 }],
    [{ name: "x".repeat(81), budget: 1 }],
    [{ name: "Trip", budget: -1 }],
    [{ name: "Trip", budget: 1.234 }],
    [{ name: "Trip", budget: "5" }],
    [null],
  ])("rejects invalid input %#", async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
  });

  it("reports a failed write", async () => {
    supabase = clientStub({ transaction_collections: { data: null, error: new Error("write failed") } });
    expect((await PUT(request({ name: "Trip", budget: 5 }))).status).toBe(500);
  });
});
