import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/budget/copy/route";
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

/** Builder returning `this`, resolving to the seeded rows for its table. */
function tableStub(rows: unknown[] | { error: unknown }) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      resolve(
        typeof rows === "object" && rows !== null && "error" in rows
          ? rows
          : { data: rows, error: null },
      ),
  };
  for (const method of ["select", "eq", "in", "limit", "update", "insert"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/budget/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupTables({
  budgets = [{ id: "b1" }, { id: "b2" }],
  previous = [
    { budget_id: "b1", planned: "250.00" },
    { budget_id: "b2", planned: 100 },
  ],
  current = [] as unknown[],
}: {
  budgets?: unknown[];
  previous?: unknown[];
  current?: unknown[];
}) {
  from.mockImplementation((table: string) => {
    if (table === "budgets") return tableStub(budgets);
    return tableStubForPeriods(previous, current);
  });
}

function tableStubForPeriods(previous: unknown[], current: unknown[]) {
  // Each builder captures its own month at `.eq("month", ...)` time, so the
  // two parallel period reads resolve independently.
  let periodMonth: string | null = null;
  const builder: Record<string, unknown> = {};
  const resolve = () => {
    if (periodMonth === "2026-08-01") {
      return { data: previous, error: null };
    }
    return { data: current, error: null };
  };
  builder.then = (res: (value: unknown) => unknown) => res(resolve());
  for (const method of ["select", "eq", "in", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      if (args[0] === "month") periodMonth = args[1] as string;
      return builder;
    };
  }
  return builder;
}

describe("POST /api/budget/copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123", email: "test@example.com" },
      supabase: { rpc, from } as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
    rpc.mockResolvedValue({ data: [{ budget_id: "b1" }], error: null });
  });

  it("copies last month's planned amounts via update_budget_period", async () => {
    setupTables({});
    const res = await POST(request({ month: "2026-09" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copied: number };
    expect(body.copied).toBe(2);
    expect(rpc).toHaveBeenCalledWith(
      "update_budget_period",
      expect.objectContaining({
        p_budget_id: "b1",
        p_month: "2026-09-01",
        p_planned: 250,
        p_group_name: null,
        p_rollover_enabled: null,
        p_sort_order: null,
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "budget_copied",
        metadata: expect.objectContaining({
          month: "2026-09-01",
          from_month: "2026-08-01",
          mode: "create",
          copied_count: 2,
        }),
      }),
    );
  });

  it("409s when the target month already has envelopes and no mode was sent", async () => {
    setupTables({ current: [{ budget_id: "b1", planned: 999 }] });
    const res = await POST(request({ month: "2026-09" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; existing_count: number };
    expect(body.error).toBe("month_not_empty");
    expect(body.existing_count).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("merge only fills envelopes the target month is missing", async () => {
    setupTables({ current: [{ budget_id: "b1", planned: 999 }] });
    const res = await POST(request({ month: "2026-09", mode: "merge" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copied: number; skipped_existing: number };
    expect(body.copied).toBe(1);
    expect(body.skipped_existing).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "update_budget_period",
      expect.objectContaining({ p_budget_id: "b2", p_planned: 100 }),
    );
  });

  it("overwrite restates every envelope after explicit confirmation", async () => {
    setupTables({ current: [{ budget_id: "b1", planned: 999 }] });
    const res = await POST(request({ month: "2026-09", mode: "overwrite" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copied: number };
    expect(body.copied).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("copies nothing and does not audit when last month has no plan", async () => {
    setupTables({ previous: [] });
    const res = await POST(request({ month: "2026-09" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copied: number };
    expect(body.copied).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a malformed month before any query", async () => {
    const res = await POST(request({ month: "september" }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates a period read failure as a 500-style error", async () => {
    from.mockImplementation((table: string) => {
      if (table === "budgets") return tableStub([{ id: "b1" }]);
      return tableStub({ error: { message: "boom", code: "P0001" } });
    });
    const res = await POST(request({ month: "2026-09" }));
    expect(res.status).toBe(500);
  });

  it("returns the auth response without touching the database when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(request({ month: "2026-09" }));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
