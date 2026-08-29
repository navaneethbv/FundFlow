import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_c: string, e: unknown) =>
    NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 }),
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { PATCH } from "@/app/api/advice/priorities/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

describe("advice priorities route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(new NextResponse("Unauthorized", { status: 401 }));
    expect((await PATCH(jsonRequest({ advice_ids: [] }))).status).toBe(401);
  });

  it("validates the id list against the educational library", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub({}) });
    expect((await PATCH(jsonRequest({ advice_ids: "nope" }))).status).toBe(400);
    const unknown = await PATCH(jsonRequest({ advice_ids: ["not-a-real-advice-id"] }));
    expect(unknown.status).toBe(400);
  });

  it("persists an ordered priority list scoped to the owner and audits it", async () => {
    const supabase = clientStub({ profiles: { data: { id: "user-1" } } });
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase });
    const res = await PATCH(jsonRequest({ advice_ids: ["emergency-fund", "high-interest-debt"] }));
    expect(res.status).toBe(200);
    expect(supabase.callsOn("profiles").some((c) => c.method === "eq" && c.args[0] === "id" && c.args[1] === "user-1")).toBe(true);
    const written = supabase.writtenTo("profiles") as Record<string, unknown>;
    expect(written.advice_priorities).toEqual(["emergency-fund", "high-interest-debt"]);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "advice_priorities_updated" }),
    );
  });
});