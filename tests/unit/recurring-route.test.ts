import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/recurring/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

// recurring_streams is a Plaid-synced table with a SELECT-only RLS policy
// (no client-writable UPDATE policy -- see the 2026-07-30 Task 15 fix). The
// route must write through the service client, not the RLS-bound cookie
// client requireUser() returns for identity. mockServiceClient's `from` is
// reassigned per test in beforeEach to a fresh clientStub().
const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const STREAM_ID = "123e4567-e89b-12d3-a456-426614174000";

function request(body: unknown): Request {
  return new Request("http://localhost/api/recurring", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * Stands in for the RLS-bound cookie client requireUser() returns. Throws on
 * any query so a regression back to writing through it (the original bug:
 * recurring_streams' RLS silently updates zero rows for that client) fails
 * the test loudly instead of passing by accident.
 */
function poisonedCookieClient() {
  return {
    from: () => {
      throw new Error(
        "PATCH /api/recurring must not query recurring_streams through the cookie client",
      );
    },
  };
}

describe("PATCH /api/recurring", () => {
  let service: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = clientStub({
      recurring_streams: { data: [{ id: STREAM_ID, user_id: "user-1" }] },
    });
    mockServiceClient.from = service.from;
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: poisonedCookieClient() as never,
    } as never);
  });

  it("rejects an unknown action", async () => {
    const response = await PATCH(request({ stream_id: STREAM_ID, action: "delete" }));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed stream_id", async () => {
    const response = await PATCH(request({ stream_id: "not-a-uuid", action: "review" }));
    expect(response.status).toBe(400);
  });

  it("sets reviewed_at on review and audits it", async () => {
    const response = await PATCH(request({ stream_id: STREAM_ID, action: "review" }));
    expect(response.status).toBe(200);
    const written = service.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.reviewed_at).toEqual(expect.any(String));
    expect(service.scopedToUser("recurring_streams", "user-1")).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_reviewed" }),
    );
  });

  it("sets dismissed_at on dismiss", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "dismiss" }));
    const written = service.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.dismissed_at).toEqual(expect.any(String));
  });

  it("clears dismissed_at on restore", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "restore" }));
    const written = service.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.dismissed_at).toBeNull();
  });

  it("requires a non-negative amount for correct_amount", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: -5 }),
    );
    expect(response.status).toBe(400);
  });

  it("sets user_amount on correct_amount", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.99 }));
    const written = service.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.user_amount).toBe(19.99);
  });

  it("accepts common subscription prices like 19.99 (regression test)", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.99 }),
    );
    expect(response.status).toBe(200);
    const written = service.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.user_amount).toBe(19.99);
  });

  it("rejects genuine 3-decimal amounts like 19.999", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.999 }),
    );
    expect(response.status).toBe(400);
  });

  it("writes through the service client rather than the RLS-bound cookie client (regression: recurring_streams has no client-writable UPDATE policy, so a cookie-client write always silently affects zero rows)", async () => {
    const response = await PATCH(request({ stream_id: STREAM_ID, action: "review" }));
    expect(response.status).toBe(200);
    // The mocked cookie client (poisonedCookieClient) throws on any `.from`
    // call; reaching a 200 here without an unhandled throw already proves
    // the route never touched it. Also assert the write actually landed on
    // the service-client stub, correctly scoped to the owning user.
    expect(service.callsOn("recurring_streams").some((call) => call.method === "update")).toBe(
      true,
    );
    expect(service.scopedToUser("recurring_streams", "user-1")).toBe(true);
  });
});
