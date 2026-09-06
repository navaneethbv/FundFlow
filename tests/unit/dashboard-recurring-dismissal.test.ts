import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardData } from "@/lib/dashboard";

/**
 * Recurring > Manage and the Dashboard's reminders read the same
 * `recurring_streams` rows, but only the dedicated page honoured the
 * dismissal. A stream marked "Not recurring" therefore kept showing as late on
 * the Dashboard while offering a Restore action on the page that owns it.
 */
const STREAM = {
  merchant_name: "T-Mobile",
  description: "T-MOBILE PCS SVC",
  average_amount: 90,
  frequency: "MONTHLY",
  category: "RENT_AND_UTILITIES",
  stream_type: "outflow",
  is_active: true,
  plaid_item_id: "item-1",
  // Well before the selected month, so an eligible stream reads as late.
  predicted_next_date: "2026-07-02",
  dismissed_at: null,
  status: "MATURE",
};

function makeSupabase(streams: unknown[]): SupabaseClient {
  const build = (table: string) => {
    const rows = table === "recurring_streams" ? streams : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt", "in", "is", "order", "range", "limit"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

async function dashboard(streams: unknown[]) {
  return getDashboardData(makeSupabase(streams), undefined, "2026-09", "user-1");
}

describe("dashboard recurring dismissal", () => {
  it("shows an eligible stream as a late reminder", async () => {
    const data = await dashboard([STREAM]);

    expect(data.subscriptions.map((s) => s.merchant)).toContain("T-Mobile");
    expect(
      data.recurringStatuses.find((status) => status.name === "T-Mobile")?.status,
    ).toBe("late");
  });

  it("drops a dismissed stream from every reminder surface", async () => {
    const data = await dashboard([{ ...STREAM, dismissed_at: "2026-08-30T12:00:00Z" }]);

    expect(data.subscriptions).toHaveLength(0);
    expect(data.recurringStatuses.some((status) => status.name === "T-Mobile")).toBe(false);
    expect(data.recurringWeeks.flatMap((week) => week.items)).toHaveLength(0);
  });

  it("reintroduces the occurrence once the stream is restored", async () => {
    const data = await dashboard([{ ...STREAM, dismissed_at: null }]);

    expect(data.subscriptions.map((s) => s.merchant)).toContain("T-Mobile");
  });

  it("drops a tombstoned stream the same way the Recurring page does", async () => {
    const data = await dashboard([{ ...STREAM, status: "TOMBSTONED" }]);

    expect(data.subscriptions).toHaveLength(0);
  });

  it("keeps a dismissed inflow out of the income streams", async () => {
    const data = await dashboard([
      { ...STREAM, stream_type: "inflow", dismissed_at: "2026-08-30T12:00:00Z" },
    ]);

    expect(data.incomeStreams).toHaveLength(0);
  });
});
