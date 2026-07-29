import { describe, it, expect, vi } from "vitest";
import { PUT } from "@/app/api/budget/route";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual("@/lib/http");
  return {
    ...actual,
    requireUser: vi.fn().mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      supabase: {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      },
    }),
  };
});

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("PUT /api/budget", () => {
  it("rejects invalid budget_id format", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_id: "invalid-id", month: "2026-07", planned: 100 }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("rejects negative planned amount", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        budget_id: "123e4567-e89b-12d3-a456-426614174000",
        month: "2026-07",
        planned: -50,
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("updates budget period and returns 200 for valid input", async () => {
    const req = new Request("http://localhost/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        budget_id: "123e4567-e89b-12d3-a456-426614174000",
        month: "2026-07",
        planned: 350.5,
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});
