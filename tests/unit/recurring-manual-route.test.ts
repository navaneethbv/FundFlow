import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH, POST } from "@/app/api/recurring/manual/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

const ITEM_ID = "123e4567-e89b-12d3-a456-426614174000";
const validCreate = {
  name: "Piano lessons",
  amount: 80,
  frequency: "monthly",
  next_date: "2026-08-05",
  item_type: "expense",
  category: "Education",
};

function req(method: string, body: unknown): Request {
  return new Request("http://localhost/api/recurring/manual", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("manual recurring items route", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = clientStub({
      manual_recurring_items: { data: [{ id: ITEM_ID }] },
    });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
    } as never);
  });

  it("rejects a create with a non-positive amount", async () => {
    const response = await POST(req("POST", { ...validCreate, amount: 0 }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown frequency", async () => {
    const response = await POST(req("POST", { ...validCreate, frequency: "daily" }));
    expect(response.status).toBe(400);
  });

  it("creates a manual item scoped to the user and audits it", async () => {
    const response = await POST(req("POST", validCreate));
    expect(response.status).toBe(200);
    const written = client.writtenTo("manual_recurring_items") as Record<string, unknown>;
    expect(written.user_id).toBe("user-1");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_recurring_item_created" }),
    );
  });

  it("updates only the provided fields, scoped to the owner", async () => {
    const response = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
    expect(response.status).toBe(200);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
  });

  it("deletes a manual item scoped to the owner", async () => {
    const response = await DELETE(req("DELETE", { id: ITEM_ID }));
    expect(response.status).toBe(200);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
  });

  it("404s an update for a row the owner filter doesn't match", async () => {
    client = clientStub({ manual_recurring_items: { data: null } });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
    } as never);
    const response = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
    expect(response.status).toBe(404);
  });

  it("rejects a PATCH name over 140 characters", async () => {
    const response = await PATCH(req("PATCH", { id: ITEM_ID, name: "a".repeat(141) }));
    expect(response.status).toBe(400);
  });
});
