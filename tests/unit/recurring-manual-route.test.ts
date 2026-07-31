import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
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

  it("rejects POST with invalid name, next_date, item_type, or category", async () => {
    expect((await POST(req("POST", { ...validCreate, name: "" }))).status).toBe(400);
    expect((await POST(req("POST", { ...validCreate, next_date: "08-05-2026" }))).status).toBe(400);
    expect((await POST(req("POST", { ...validCreate, item_type: "other" }))).status).toBe(400);
    expect((await POST(req("POST", { ...validCreate, category: 123 }))).status).toBe(400);
    expect((await POST(req("POST", "invalid json"))).status).toBe(400);
  });

  it("rejects PATCH with invalid id, amount, frequency, next_date, item_type, category, or enabled", async () => {
    expect((await PATCH(req("PATCH", { id: "invalid-uuid" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, name: "" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: -50 }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, frequency: "yearly-plus" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, next_date: "invalid" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, item_type: "invalid" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, category: 123 }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, enabled: "yes" }))).status).toBe(400);
  });

  it("rejects DELETE with invalid id", async () => {
    expect((await DELETE(req("DELETE", { id: "invalid-uuid" }))).status).toBe(400);
  });

  it("handles DB errors on POST, PATCH, DELETE", async () => {
    client = clientStub({ manual_recurring_items: { error: new Error("DB Error") } });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1" },
      supabase: client as never,
    } as never);

    expect((await POST(req("POST", validCreate))).status).toBe(500);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: 100 }))).status).toBe(500);
    expect((await DELETE(req("DELETE", { id: ITEM_ID }))).status).toBe(500);
  });

  it("returns auth response when unauthenticated", async () => {
    const authErr = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireUser).mockResolvedValue(authErr as never);

    expect((await POST(req("POST", validCreate))).status).toBe(401);
    expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: 100 }))).status).toBe(401);
    expect((await DELETE(req("DELETE", { id: ITEM_ID }))).status).toBe(401);
  });
});
