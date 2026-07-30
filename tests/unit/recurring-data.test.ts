import { describe, expect, it } from "vitest";
import { loadRecurringData } from "@/lib/recurring-data";
import { clientStub } from "../fixtures/supabase-query";

function makeClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  return clientStub({
    households: { data: [] },
    recurring_streams: {
      data: [
        {
          id: "stream-1",
          merchant_name: "Netflix",
          description: null,
          stream_type: "outflow",
          status: "MATURE",
          is_active: true,
          reviewed_at: "2026-01-01T00:00:00Z",
          dismissed_at: null,
          user_amount: null,
          average_amount: 15.49,
          last_amount: 15.49,
          frequency: "MONTHLY",
          first_date: "2026-01-15",
          last_date: "2026-06-15",
          predicted_next_date: "2026-07-15",
          account_id: "account-1",
        },
      ],
    },
    recurring_stream_transactions: { data: [] },
    manual_recurring_items: { data: [] },
    accounts: { data: [{ id: "account-1", name: "Checking", type: "depository", subtype: null }] },
    sync_jobs: { data: null },
    ...overrides,
  });
}

describe("loadRecurringData", () => {
  it("scopes every query to the requesting user in mine scope", async () => {
    const client = makeClient();
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(client.scopedToUser("recurring_streams", "user-1")).toBe(true);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
    expect(result.view.occurrences).toHaveLength(1);
    expect(result.view.occurrences[0]!.merchant).toBe("Netflix");
  });

  it("reports stale when the newest done sync job is more than 48h old", async () => {
    const client = makeClient({
      sync_jobs: { data: { updated_at: "2020-01-01T00:00:00Z" } },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      now: new Date("2026-07-20T00:00:00Z"),
    });
    expect(result.stale).toBe(true);
  });

  it("marks a stream's occurrences against a credit account in the creditCards bucket", async () => {
    const client = makeClient({
      accounts: { data: [{ id: "account-1", name: "Card", type: "credit", subtype: "credit card" }] },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.totals.creditCards.remaining).toBeGreaterThan(0);
  });
});
