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

const STREAM_ID = "123e4567-e89b-12d3-a456-426614174000";

function request(body: unknown): Request {
  return new Request("http://localhost/api/recurring", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/recurring", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = clientStub({
      recurring_streams: { data: [{ id: STREAM_ID, user_id: "user-1" }] },
    });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
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
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.reviewed_at).toEqual(expect.any(String));
    expect(client.scopedToUser("recurring_streams", "user-1")).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_reviewed" }),
    );
  });

  it("sets dismissed_at on dismiss", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "dismiss" }));
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.dismissed_at).toEqual(expect.any(String));
  });

  it("clears dismissed_at on restore", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "restore" }));
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
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
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.user_amount).toBe(19.99);
  });

  it("accepts common subscription prices like 19.99 (regression test)", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.99 }),
    );
    expect(response.status).toBe(200);
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.user_amount).toBe(19.99);
  });

  it("rejects genuine 3-decimal amounts like 19.999", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.999 }),
    );
    expect(response.status).toBe(400);
  });
});
