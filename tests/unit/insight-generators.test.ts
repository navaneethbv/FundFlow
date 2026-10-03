import { describe, expect, it } from "vitest";
import { generateInsights, type InsightInputs } from "@/lib/insight-generators";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
const row = (
  id: string,
  date: string,
  amount = 100,
): CanonicalFinanceTransaction => ({
  id,
  sourceTransactionId: id,
  date,
  signedAmount: amount,
  flow: "expense",
  merchant: "Coffee",
  groupKey: "FOOD",
  categoryKey: "FOOD",
  accountId: "a",
  manualAccountId: null,
  pending: false,
  source: "plaid",
});
const input = (
  transactions: CanonicalFinanceTransaction[] = [],
): InsightInputs => ({
  today: "2026-10-10",
  historyStart: "2026-07-01",
  transactions,
  bills: [],
  accounts: [],
  reserves: [],
});
describe("explained insights", () => {
  it("checks only adjacent charge pairs and coalesces split parts", () => {
    const signals = generateInsights(
      input([
        row("a", "2026-10-09"),
        row("b", "2026-10-09"),
        row("c", "2026-10-10"),
        { ...row("split", "2026-10-10", 50), sourceTransactionId: "c" },
      ]),
    );
    expect(
      signals
        .filter((s) => s.type === "double_charge")
        .map((s) => s.subjectKey),
    ).toEqual(["double_charge:a:b"]);
  });
  it("excludes pending, transfers, future dates and differing accounts", () => {
    const signals = generateInsights(
      input([
        { ...row("a", "2026-10-10"), pending: true },
        { ...row("b", "2026-10-10"), groupKey: "TRANSFER_OUT" },
        row("c", "2026-10-11"),
        row("d", "2026-10-10", 10),
        { ...row("e", "2026-10-10", 10), accountId: "b" },
      ]),
    );
    expect(signals).toEqual([]);
  });
  it("explains new merchants and a three-times median spike", () => {
    const signals = generateInsights(
      input([
        row("a", "2026-07-02", 20),
        row("b", "2026-08-02", 30),
        row("c", "2026-09-02", 40),
        row("d", "2026-10-09", 100),
        { ...row("e", "2026-10-10", 120), merchant: "Books" },
      ]),
    );
    expect(
      signals.find((s) => s.type === "merchant_spike")?.details.body,
    ).toContain("median $30.00");
    expect(signals.find((s) => s.type === "new_merchant")?.subjectKey).toBe(
      "new_merchant:e",
    );
  });
  it("paces categories using three complete months and nets refunds", () => {
    const history = [
      row("a", "2026-07-02"),
      row("b", "2026-08-02"),
      row("c", "2026-09-02"),
      row("d", "2026-10-09", 300),
    ];
    expect(
      generateInsights(input(history)).some((s) => s.type === "category_spike"),
    ).toBe(true);
    expect(
      generateInsights(
        input([...history, row("refund", "2026-10-09", -290)]),
      ).some((s) => s.type === "category_spike"),
    ).toBe(false);
    expect(
      generateInsights({ ...input(history), historyStart: "2026-09-01" }).some(
        (s) => s.type === "category_spike",
      ),
    ).toBe(false);
  });
  it("uses only completed calendar months for savings, requiring income in both", () => {
    const tx = [
      row("a", "2026-08-02", 50),
      row("b", "2026-09-02", 90),
      { ...row("i", "2026-08-01", -100), flow: "income" as const },
      { ...row("j", "2026-09-01", -100), flow: "income" as const },
    ];
    const signal = generateInsights(
      input([...tx, row("huge", "2026-10-10", 10000)]),
    ).find((s) => s.type === "savings_rate_change");
    expect(signal?.details.body).toContain("50.0% then 10.0%");
    expect(
      generateInsights(input(tx.slice(0, 3))).some(
        (s) => s.type === "savings_rate_change",
      ),
    ).toBe(false);
  });
  it("rotates idle cash monthly and never treats unknown balances as zero", () => {
    const data = {
      ...input(),
      accounts: [
        {
          id: "a",
          name: "Reserve",
          balance: 6000,
          opened: "2026-01-01",
          lastActivity: null,
        },
        {
          id: "b",
          name: "Unknown",
          balance: null,
          opened: "2026-01-01",
          lastActivity: null,
        },
      ],
    };
    expect(generateInsights(data).map((s) => s.subjectKey)).toEqual([
      "idle_cash:a:2026-10-01",
    ]);
    expect(
      generateInsights({ ...data, today: "2026-11-01" })[0]?.subjectKey,
    ).toBe("idle_cash:a:2026-11-01");
    expect(
      generateInsights({
        ...data,
        accounts: [{ ...data.accounts[0]!, lastActivity: "2026-10-01" }],
      }),
    ).toEqual([]);
  });
  it("explains overdue payment uncertainty and reserve gaps", () => {
    const signals = generateInsights({
      ...input(),
      bills: [
        {
          id: "rent",
          name: "Rent",
          dueDate: "2026-10-01",
          amount: 1000,
          overdue: true,
        },
      ],
      reserves: [{ id: "g", name: "Emergency", target: 5000, funded: 4000 }],
    });
    expect(signals.map((s) => s.type)).toEqual([
      "bill_overdue",
      "goal_reserve_depleted",
    ]);
    expect(signals[1]?.details.body).toContain("gap of $1,000.00");
  });
});
