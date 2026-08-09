import { describe, expect, it } from "vitest";
import { detectDuplicatePairs } from "@/lib/transaction-quality";

const base = [
  { id: "a", date: "2026-08-01", merchant: "Corner  Cafe", amount: 24.5, accountId: "account-1", plaidItemId: "item-1", accountName: "Card A" },
  { id: "b", date: "2026-08-03", merchant: " corner cafe ", amount: 24.5, accountId: "account-2", plaidItemId: "item-2", accountName: "Card B" },
];

describe("detectDuplicatePairs", () => {
  it("matches equal cents and normalized merchants at the two-day boundary", () => {
    expect(detectDuplicatePairs(base, [])).toEqual([expect.objectContaining({
      subjectId: "a:b",
      first: base[0],
      second: base[1],
    })]);
  });

  it.each([
    ["different cents", { ...base[1], amount: 24.51 }],
    ["different merchant", { ...base[1], merchant: "Other" }],
    ["outside date", { ...base[1], date: "2026-08-04" }],
    ["same account", { ...base[1], accountId: "account-1" }],
    ["income", { ...base[1], amount: -24.5 }],
  ])("rejects %s", (_label, second) => {
    expect(detectDuplicatePairs([base[0]!, second], [])).toEqual([]);
  });

  it("allows different connected items and removes resolved decisions", () => {
    expect(detectDuplicatePairs(base, [{
      kind: "duplicate",
      subjectId: "a:b",
      decision: "dismissed",
    }])).toEqual([]);
    expect(detectDuplicatePairs(base, [{
      kind: "duplicate",
      subjectId: "a:b",
      decision: "confirmed",
    }])).toEqual([]);
  });

  it("uses each transaction once and resolves ambiguous repeats deterministically", () => {
    const transactions = [
      ...base,
      { ...base[1]!, id: "c", date: "2026-08-01", accountId: "account-3" },
    ];

    const result = detectDuplicatePairs(transactions, []);

    expect(result).toHaveLength(1);
    expect(result[0]!.subjectId).toBe("a:c");
  });
});
