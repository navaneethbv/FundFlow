import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { POST, PUT } from "@/app/api/budget/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
}));

const validBody = {
  budget_id: "123e4567-e89b-12d3-a456-426614174000",
  month: "2026-07",
  planned: 350.5,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/budget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PUT /api/budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      supabase: { rpc, from } as never,
    } as never);
    rpc.mockResolvedValue({
      data: [
        {
          budget_id: validBody.budget_id,
          month: "2026-07-01",
          planned: 350.5,
          group_name: "flexible",
          rollover_enabled: false,
          sort_order: 0,
        },
      ],
      error: null,
    });
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("returns the authentication response without touching the database", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await PUT(request(validBody));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{", "Invalid JSON payload"],
    ["an array payload", [], "Invalid JSON payload"],
    ["an invalid budget id", { ...validBody, budget_id: "invalid-id" }, "Invalid budget_id"],
    ["a malformed month", { ...validBody, month: "2026-7" }, "Invalid month"],
    ["a suffixed month", { ...validBody, month: "2026-07-extra" }, "Invalid month"],
    ["a negative amount", { ...validBody, planned: -50 }, "Invalid planned amount"],
    ["a string amount", { ...validBody, planned: "350.50" }, "Invalid planned amount"],
    ["too many decimals", { ...validBody, planned: 1.001 }, "Invalid planned amount"],
    ["an invalid group", { ...validBody, group_name: "other" }, "Invalid group_name"],
    ["a non-boolean rollover", { ...validBody, rollover_enabled: "false" }, "Invalid rollover_enabled"],
    ["a fractional sort order", { ...validBody, sort_order: 1.5 }, "Invalid sort_order"],
    ["a negative sort order", { ...validBody, sort_order: -1 }, "Invalid sort_order"],
  ])("rejects %s before any write", async (_name, body, message) => {
    const response = await PUT(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(rpc).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("performs one atomic owner-scoped mutation and returns the saved row", async () => {
    const response = await PUT(
      request({
        ...validBody,
        group_name: "fixed",
        rollover_enabled: true,
        sort_order: 2,
      }),
    );

    expect(rpc).toHaveBeenCalledWith("update_budget_period", {
      p_budget_id: validBody.budget_id,
      p_month: "2026-07-01",
      p_planned: 350.5,
      p_group_name: "fixed",
      p_rollover_enabled: true,
      p_sort_order: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      budget_id: validBody.budget_id,
      month: "2026-07-01",
      planned: 350.5,
      group_name: "flexible",
      rollover_enabled: false,
      sort_order: 0,
    });
    expect(writeAudit).toHaveBeenCalledWith({
      userId: "user-123",
      action: "budget_updated",
      metadata: {
        budget_id: validBody.budget_id,
        month: "2026-07-01",
        changed_fields: [
          "planned",
          "group_name",
          "rollover_enabled",
          "sort_order",
        ],
      },
    });
  });

  it("passes null metadata fields so the database preserves current values", async () => {
    await PUT(request(validBody));

    expect(rpc).toHaveBeenCalledWith(
      "update_budget_period",
      expect.objectContaining({
        p_group_name: null,
        p_rollover_enabled: null,
        p_sort_order: null,
      }),
    );
  });

  it("returns not found for a missing or read-only household budget", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "budget_not_found" },
    });

    const response = await PUT(request(validBody));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Budget not found" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("does not audit a failed atomic mutation", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "database detail" },
    });

    const response = await PUT(request(validBody));

    expect(response.status).toBe(500);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/budget", () => {
  const item = {
    category: "Groceries",
    monthly_limit: 450,
    group_name: "flexible",
    rollover_enabled: false,
    sort_order: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      supabase: { rpc, from } as never,
    } as never);
    const existing = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    };
    const inserted = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: "budget-new", category: "Groceries" }],
          error: null,
        }),
      }),
    };
    from.mockReturnValueOnce(existing).mockReturnValueOnce(inserted);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it.each([
    ["an empty batch", { month: "2026-07", items: [] }],
    [
      "duplicate categories",
      { month: "2026-07", items: [item, { ...item, category: "groceries" }] },
    ],
    [
      "an invalid amount",
      { month: "2026-07", items: [{ ...item, monthly_limit: -1 }] },
    ],
    [
      "an invalid group",
      { month: "2026-07", items: [{ ...item, group_name: "other" }] },
    ],
    [
      "a malformed category",
      { month: "2026-07", items: [{ ...item, category: " " }] },
    ],
  ])("rejects %s before querying budgets", async (_name, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts only reviewed new items in one owner-scoped batch", async () => {
    const response = await POST(
      request({
        month: "2026-07",
        items: [item, { ...item, category: "Rent", group_name: "fixed" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(from).toHaveBeenNthCalledWith(1, "budgets");
    expect(from).toHaveBeenNthCalledWith(2, "budgets");
    const insertBuilder = from.mock.results[1]?.value as {
      insert: ReturnType<typeof vi.fn>;
    };
    expect(insertBuilder.insert).toHaveBeenCalledWith([
      {
        user_id: "user-123",
        category: "Groceries",
        monthly_limit: 450,
        group_name: "flexible",
        rollover_enabled: false,
        sort_order: 0,
      },
      {
        user_id: "user-123",
        category: "Rent",
        monthly_limit: 450,
        group_name: "fixed",
        rollover_enabled: false,
        sort_order: 0,
      },
    ]);
    expect(await response.json()).toEqual({
      created: [{ id: "budget-new", category: "Groceries" }],
      skipped: [],
    });
    expect(writeAudit).toHaveBeenCalledWith({
      userId: "user-123",
      action: "budget_proposals_created",
      metadata: {
        month: "2026-07-01",
        created_budget_ids: ["budget-new"],
        skipped_count: 0,
      },
    });
  });

  it("skips existing owner categories without overwriting them", async () => {
    const existing = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [{ id: "budget-old", category: "groceries" }],
            error: null,
          }),
        }),
      }),
    };
    from.mockReset();
    from.mockReturnValueOnce(existing);

    const response = await POST(
      request({ month: "2026-07", items: [item] }),
    );

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      created: [],
      skipped: ["Groceries"],
    });
  });
});
