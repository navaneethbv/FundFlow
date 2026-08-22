import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: String((error as Error)?.message ?? error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

const mockServiceFrom = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: (...args: unknown[]) => mockServiceFrom(...args) }),
}));

import { clientStub } from "../fixtures/supabase-query";
import { PATCH } from "@/app/api/recurring/route";

const ITEM_ID = "123e4567-e89b-12d3-a456-426614174000";

function req(body: unknown, rejectJson = false): Request {
  return {
    url: "https://x.local/api/recurring",
    json: rejectJson
      ? () => Promise.reject(new Error("bad json"))
      : () => Promise.resolve(body),
  } as unknown as Request;
}

function rejectingChain() {
  const chain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.reject(new Error("boom"))),
  };
  return chain;
}

describe("coverage-boost-r5-n1 recurring/route.ts", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" } });
    client = clientStub({
      recurring_streams: { data: { id: ITEM_ID }, error: null },
    });
    mockServiceFrom.mockImplementation((table: unknown) => client.from(table as string));
  });

  it("returns the auth response when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(res.status).toBe(401);
  });

  it("rejects with Invalid JSON payload when json() rejects", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }, true));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
  });

  it("rejects a non-object payload", async () => {
    const res = await PATCH(req("not-an-object"));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
  });

  it("rejects an array payload", async () => {
    const res = await PATCH(req([{ stream_id: ITEM_ID, action: "review" }]));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
  });

  it("rejects a non-string stream_id", async () => {
    const res = await PATCH(req({ stream_id: 123, action: "review" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid stream_id");
  });

  it("rejects a malformed stream_id", async () => {
    const res = await PATCH(req({ stream_id: "not-a-uuid", action: "review" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid stream_id");
  });

  it("rejects a non-string action", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: 5 }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid action");
  });

  it("rejects an unknown action", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "nuke" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid action");
  });

  it("rejects correct_amount without a numeric amount", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "correct_amount" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
  });

  it("rejects correct_amount with a non-finite amount", async () => {
    const res = await PATCH(
      req({ stream_id: ITEM_ID, action: "correct_amount", amount: NaN }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
  });

  it("rejects correct_amount with a negative amount", async () => {
    const res = await PATCH(
      req({ stream_id: ITEM_ID, action: "correct_amount", amount: -1 }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
  });

  it("rejects correct_amount with more than two decimals", async () => {
    const res = await PATCH(
      req({ stream_id: ITEM_ID, action: "correct_amount", amount: 1.234 }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
  });

  it("applies the review action and audits it", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ stream_id: ITEM_ID, action: "review" });
    expect(client.writtenTo("recurring_streams")).toEqual({
      reviewed_at: expect.any(String),
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_reviewed" }),
    );
  });

  it("applies the dismiss action and audits it", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "dismiss" }));
    expect(res.status).toBe(200);
    expect(client.writtenTo("recurring_streams")).toEqual({
      dismissed_at: expect.any(String),
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_dismissed" }),
    );
  });

  it("applies the restore action and clears the dismissed_at timestamp", async () => {
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "restore" }));
    expect(res.status).toBe(200);
    expect(client.writtenTo("recurring_streams")).toEqual({ dismissed_at: null });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_restored" }),
    );
  });

  it("applies correct_amount with a valid two-decimal amount", async () => {
    const res = await PATCH(
      req({ stream_id: ITEM_ID, action: "correct_amount", amount: 12.34 }),
    );
    expect(res.status).toBe(200);
    expect(client.writtenTo("recurring_streams")).toEqual({ user_amount: 12.34 });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_amount_corrected" }),
    );
  });

  it("scopes the update to the owning user", async () => {
    await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(client.scopedToUser("recurring_streams", "user-1")).toBe(true);
    const eqCalls = client.callsOn("recurring_streams").filter(
      (c) => c.method === "eq",
    );
    expect(eqCalls.some((c) => c.args[0] === "id" && c.args[1] === ITEM_ID)).toBe(true);
  });

  it("returns errorResponse when the update fails", async () => {
    client = clientStub({
      recurring_streams: { data: null, error: { message: "db" } },
    });
    mockServiceFrom.mockImplementation((table: unknown) => client.from(table as string));
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.update", {
      message: "db",
    });
  });

  it("returns 404 when the stream is not found", async () => {
    client = clientStub({
      recurring_streams: { data: null, error: null },
    });
    mockServiceFrom.mockImplementation((table: unknown) => client.from(table as string));
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Recurring stream not found",
    });
  });

  it("returns errorResponse when the update chain rejects", async () => {
    mockServiceFrom.mockReturnValue(rejectingChain());
    const res = await PATCH(req({ stream_id: ITEM_ID, action: "review" }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("recurring.update", expect.any(Error));
  });
});