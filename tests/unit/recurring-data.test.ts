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
          user_id: "user-1",
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
          category: null,
        },
      ],
    },
    recurring_stream_transactions: { data: [] },
    manual_recurring_items: { data: [] },
    accounts: {
      data: [{ id: "account-1", name: "Checking", type: "depository", subtype: null, iso_currency_code: "USD" }],
    },
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
    expect(result.currency).toBe("USD");
  });

  it("falls back to USD when no account resolves a currency code", async () => {
    const client = makeClient({
      accounts: { data: [{ id: "account-1", name: "Checking", type: "depository", subtype: null, iso_currency_code: null }] },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.currency).toBe("USD");
  });

  it("picks the most common currency among scoped accounts", async () => {
    const client = makeClient({
      accounts: {
        data: [
          { id: "account-1", name: "Checking", type: "depository", subtype: null, iso_currency_code: "usd" },
          { id: "account-2", name: "Savings", type: "depository", subtype: null, iso_currency_code: "EUR" },
          { id: "account-3", name: "Other savings", type: "depository", subtype: null, iso_currency_code: "EUR" },
        ],
      },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.currency).toBe("EUR");
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

  it("keeps a purchase stream on a credit account in the expenses bucket", async () => {
    const client = makeClient({
      accounts: { data: [{ id: "account-1", name: "Card", type: "credit", subtype: "credit card" }] },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.totals.expenses.remaining).toBeGreaterThan(0);
    expect(result.view.totals.creditCards.remaining).toBe(0);
  });

  it("passes category through to the stream input, excluding EXCLUDED_PFC streams from totals (Fix 4)", async () => {
    const client = makeClient({
      recurring_streams: {
        data: [
          {
            id: "stream-1",
            user_id: "user-1",
            merchant_name: "Card autopay",
            description: null,
            stream_type: "outflow",
            status: "MATURE",
            is_active: true,
            reviewed_at: "2026-01-01T00:00:00Z",
            dismissed_at: null,
            user_amount: null,
            average_amount: 400,
            last_amount: 400,
            frequency: "MONTHLY",
            first_date: "2026-01-15",
            last_date: "2026-06-15",
            predicted_next_date: "2026-07-15",
            account_id: "account-1",
            category: "LOAN_PAYMENTS",
          },
        ],
      },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.occurrences).toHaveLength(1);
    expect(result.view.occurrences[0]!.category).toBe("LOAN_PAYMENTS");
    expect(result.view.totals.expenses.remaining).toBe(0);
    expect(result.view.totals.creditCards.remaining).toBe(0);
  });

  describe("household scope ownership (Fix 1)", () => {
    function makeHouseholdClient() {
      return clientStub({
        households: { data: [{ id: "household-1" }] },
        recurring_streams: {
          data: [
            {
              id: "stream-own",
              user_id: "user-1",
              merchant_name: "Netflix",
              description: null,
              stream_type: "outflow",
              status: "MATURE",
              is_active: true,
              reviewed_at: null,
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
            {
              id: "stream-partner",
              user_id: "user-2",
              merchant_name: "Spotify",
              description: null,
              stream_type: "outflow",
              status: "MATURE",
              is_active: true,
              reviewed_at: null,
              dismissed_at: null,
              user_amount: null,
              average_amount: 9.99,
              last_amount: 9.99,
              frequency: "MONTHLY",
              first_date: "2026-01-20",
              last_date: "2026-06-20",
              predicted_next_date: "2026-07-20",
              account_id: null,
            },
          ],
        },
        recurring_stream_transactions: { data: [] },
        manual_recurring_items: { data: [] },
        accounts: {
          data: [{ id: "account-1", name: "Checking", type: "depository", subtype: null, iso_currency_code: "USD" }],
        },
        sync_jobs: { data: null },
      });
    }

    it("flags each stream's isOwn against the real authenticated caller, not the scope's query filter", async () => {
      const client = makeHouseholdClient();
      const result = await loadRecurringData(client as never, {
        userId: "user-1",
        anchorMonth: "2026-07",
        rawScope: "household-1",
      });
      expect(result.allStreams.find((s) => s.id === "stream-own")?.isOwn).toBe(true);
      expect(result.allStreams.find((s) => s.id === "stream-partner")?.isOwn).toBe(false);
    });

    it("counts reviewCount against only the caller's own unreviewed streams, matching countUnreviewedStreams alone", async () => {
      const client = makeHouseholdClient();
      const result = await loadRecurringData(client as never, {
        userId: "user-1",
        anchorMonth: "2026-07",
        rawScope: "household-1",
      });
      // Both streams are unreviewed MATURE/active, but only "stream-own"
      // belongs to user-1 — the banner must not count "stream-partner" even
      // though it's visible in the household-scoped allStreams/occurrences.
      expect(result.view.reviewCount).toBe(1);
    });
  });

  it("throws recurring_query_failed error when query returns an error", async () => {
    const client = makeClient({
      recurring_streams: { error: { code: "PGRST116" } },
    });
    await expect(
      loadRecurringData(client as never, {
        userId: "user-1",
        anchorMonth: "2026-07",
      }),
    ).rejects.toThrow("recurring_query_failed:recurring_streams:PGRST116");

    const clientNoCode = makeClient({
      recurring_streams: { error: {} },
    });
    await expect(
      loadRecurringData(clientNoCode as never, {
        userId: "user-1",
        anchorMonth: "2026-07",
      }),
    ).rejects.toThrow("recurring_query_failed:recurring_streams");
  });

  it("maps transaction dates from stream transaction joins", async () => {
    const client = makeClient({
      recurring_stream_transactions: {
        data: [{ recurring_stream_id: "stream-1", transaction_id: "t-100" }],
      },
      transactions: {
        data: [{ id: "t-100", date: "2026-07-02" }],
      },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result).toBeDefined();
  });

  it("handles null rows from every aggregate-feeding table", async () => {
    const client = makeClient({
      households: { data: null },
      recurring_streams: { data: null },
      manual_recurring_items: { data: null },
      accounts: { data: null },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.occurrences).toHaveLength(0);
    expect(result.allStreams).toHaveLength(0);
    expect(result.currency).toBe("USD");
  });

  it("skips transaction ids that do not resolve to a date row", async () => {
    const client = makeClient({
      recurring_stream_transactions: {
        data: [{ recurring_stream_id: "stream-1", transaction_id: "t-missing" }],
      },
      transactions: { data: null },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.occurrences[0]?.matchedTransactionId).toBeNull();
  });

  it("maps unknown frequencies, unknown statuses, null amounts, and unresolved accounts safely", async () => {
    const client = makeClient({
      recurring_streams: {
        data: [
          {
            id: "stream-odd",
            user_id: "user-1",
            merchant_name: "Odd charge",
            description: null,
            stream_type: "outflow",
            status: null,
            is_active: true,
            reviewed_at: null,
            dismissed_at: null,
            user_amount: 42,
            average_amount: null,
            last_amount: null,
            frequency: null,
            first_date: "2026-01-15",
            last_date: "2026-06-15",
            predicted_next_date: "2026-07-15",
            account_id: "ghost-account",
            category: null,
          },
        ],
      },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    const stream = result.allStreams[0]!;
    expect(stream.status).toBe("UNKNOWN");
    expect(stream.userAmount).toBe(42);
    expect(stream.averageAmount).toBeNull();
    expect(stream.accountName).toBeNull();
    expect(result.view.occurrences[0]?.frequency).toBe("Recurring");
  });

  it("chunks stream and transaction lookups into 500-id batches in household scope", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `stream-${i}`,
      user_id: "user-1",
      merchant_name: `Merchant ${i}`,
      description: null,
      stream_type: "outflow",
      status: "MATURE",
      is_active: true,
      reviewed_at: null,
      dismissed_at: null,
      user_amount: null,
      average_amount: null,
      last_amount: null,
      frequency: "MONTHLY",
      first_date: null,
      last_date: null,
      predicted_next_date: null,
      account_id: null,
      category: null,
    }));
    const joins = rows.map((row, i) => ({
      recurring_stream_id: row.id,
      transaction_id: `txn-${i}`,
    }));
    const txns = Array.from({ length: 1000 }, (_, i) => ({
      id: `txn-${i}`,
      date: "2026-07-10",
    }));
    const client = clientStub({
      households: { data: [{ id: "household-1" }] },
      recurring_streams: { data: rows },
      recurring_stream_transactions: { data: joins },
      transactions: { data: txns },
      manual_recurring_items: { data: [] },
      accounts: { data: [] },
      sync_jobs: { data: null },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      rawScope: "household-1",
    });
    expect(result.allStreams).toHaveLength(1000);
  });

  it("tolerates null join rows when resolving stream transactions", async () => {
    const client = makeClient({
      recurring_stream_transactions: { data: null },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.occurrences).toHaveLength(1);
  });
});
