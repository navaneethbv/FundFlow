import { describe, expect, it } from "vitest";
import {
  buildDemoAccountSnapshots,
  buildDemoDataset,
} from "@/lib/demo-data";

type DemoTransaction = ReturnType<typeof buildDemoDataset>["transactions"][number];

/** Groups the checking-account (`accountIndex` 0) transactions by `YYYY-MM`. */
function checkingByMonth(
  transactions: readonly DemoTransaction[],
): Map<string, DemoTransaction[]> {
  const byMonth = new Map<string, DemoTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.accountIndex !== 0) continue;
    const month = transaction.date.slice(0, 7);
    const bucket = byMonth.get(month) ?? [];
    bucket.push(transaction);
    byMonth.set(month, bucket);
  }
  return byMonth;
}

function countByDate(transactions: readonly DemoTransaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    counts.set(transaction.date, (counts.get(transaction.date) ?? 0) + 1);
  }
  return counts;
}

describe("buildDemoDataset", () => {
  const input = { userId: "user-abc", today: "2026-07-23" };

  it("is deterministic for the same user", () => {
    expect(buildDemoDataset(input)).toEqual(buildDemoDataset(input));
  });

  it("marks everything demo-prefixed and the item as disconnected", () => {
    const data = buildDemoDataset(input);
    expect(data.item.plaid_item_id.startsWith("demo-item-")).toBe(true);
    expect(data.item.status).toBe("disconnected");
    expect(data.accounts.every((a) => a.plaid_account_id.startsWith("demo-"))).toBe(true);
    expect(
      data.transactions.every((t) => t.plaid_transaction_id.startsWith("demo-")),
    ).toBe(true);
  });

  it("follows the Plaid sign convention with income and rent each month", () => {
    const data = buildDemoDataset({ ...input, months: 2 });
    const paychecks = data.transactions.filter((t) => t.pfc_primary === "INCOME");
    const rent = data.transactions.filter((t) => t.name === "Maple Street Apartments");
    expect(paychecks).toHaveLength(4); // 2 per month
    expect(paychecks.every((t) => t.amount < 0)).toBe(true);
    expect(rent).toHaveLength(2);
    expect(rent.every((t) => t.amount > 0)).toBe(true);
  });

  // The Ledger Strip anchors to the depository account, so demo density on
  // that account is what every screenshot and visual baseline of the widget
  // actually exercises. Three entries a month hid a layout failure that only
  // appears at realistic volume.
  it("gives the checking account 30 to 40 entries in every generated month", () => {
    for (const userId of ["user-abc", "user-def", "seed-zzz", "another-user-9"]) {
      const data = buildDemoDataset({ userId, today: "2026-07-23" });
      const byMonth = checkingByMonth(data.transactions);

      expect(byMonth.size).toBe(6);
      for (const [month, entries] of byMonth) {
        expect(
          entries.length,
          `${userId} ${month} had ${entries.length} checking entries`,
        ).toBeGreaterThanOrEqual(30);
        expect(
          entries.length,
          `${userId} ${month} had ${entries.length} checking entries`,
        ).toBeLessThanOrEqual(40);
      }
    }
  });

  it("puts at least five checking entries on one date in every generated month", () => {
    for (const userId of ["user-abc", "user-def", "seed-zzz"]) {
      const data = buildDemoDataset({ userId, today: "2026-07-23" });

      for (const [month, entries] of checkingByMonth(data.transactions)) {
        const busiest = Math.max(...countByDate(entries).values());
        expect(busiest, `${userId} ${month} busiest date had ${busiest}`).toBeGreaterThanOrEqual(
          5,
        );
      }
    }
  });

  it("keeps the credit account active alongside the busier checking account", () => {
    const data = buildDemoDataset(input);
    const credit = data.transactions.filter((t) => t.accountIndex === 1);

    expect(credit.length).toBeGreaterThan(0);
  });

  it("keeps every transaction id unique", () => {
    const data = buildDemoDataset(input);
    const ids = new Set(data.transactions.map((t) => t.plaid_transaction_id));

    expect(ids.size).toBe(data.transactions.length);
  });

  it("builds only current-day snapshots from returned demo account ids", () => {
    const data = buildDemoDataset(input);

    expect(
      buildDemoAccountSnapshots({
        userId: input.userId,
        today: input.today,
        accounts: data.accounts,
        accountIds: ["account-1", "account-2"],
      }),
    ).toEqual([
      {
        user_id: input.userId,
        account_id: "account-1",
        manual_account_id: null,
        snapshot_date: input.today,
        current_balance: 4820.55,
        available_balance: null,
        iso_currency_code: "USD",
      },
      {
        user_id: input.userId,
        account_id: "account-2",
        manual_account_id: null,
        snapshot_date: input.today,
        current_balance: 1240.3,
        available_balance: null,
        iso_currency_code: "USD",
      },
    ]);
  });

  it("refuses to pair demo accounts with a mismatched id list", () => {
    const data = buildDemoDataset(input);

    expect(() =>
      buildDemoAccountSnapshots({
        userId: input.userId,
        today: input.today,
        accounts: data.accounts,
        accountIds: ["account-1"],
      }),
    ).toThrow("Demo account ids did not match the inserted accounts.");
  });
});
