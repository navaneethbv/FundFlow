import { describe, expect, it } from "vitest";
import { buildDemoDataset } from "@/lib/demo-data";

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
});
