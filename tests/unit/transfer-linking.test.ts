import { describe, it, expect } from "vitest";
import {
  detectTransferPairs,
  transferSubjectId,
} from "@/lib/transaction-quality";
import { projectFinanceTransactions } from "@/lib/finance-domain";
import { fromTransactionRow } from "@/lib/finance-domain";

const WINDOW = 7;

function txn(overrides: Record<string, unknown>) {
  return {
    id: "t",
    user_id: "u1",
    account_id: "acc-1",
    manual_account_id: null,
    plaid_transaction_id: "x",
    date: "2026-09-01",
    amount: 100,
    merchant_name: "Checking",
    name: "Checking",
    pfc_primary: "TRANSFER_OUT",
    pfc_detailed: null,
    pending: false,
    ...overrides,
  };
}

describe("detectTransferPairs", () => {
  const out = {
    id: "out1",
    date: "2026-09-01",
    merchant: "Web payment to card",
    amount: 500,
    accountId: "checking",
  };
  const inbound = {
    id: "in1",
    date: "2026-09-02",
    merchant: "Card payment",
    amount: -500,
    accountId: "card",
  };

  it("pairs an outflow with a same-amount inflow on a different account", () => {
    const pairs = detectTransferPairs([out, inbound], WINDOW);
    expect(pairs).toEqual([
      {
        subjectId: transferSubjectId("out1", "in1"),
        outId: "out1",
        inId: "in1",
        amount: 500,
        outDate: "2026-09-01",
        inDate: "2026-09-02",
      },
    ]);
  });

  it("never pairs rows on the same account", () => {
    const pairs = detectTransferPairs(
      [out, { ...inbound, accountId: "checking" }],
      WINDOW,
    );
    expect(pairs).toEqual([]);
  });

  it("respects the window with symmetric date tolerance (inflow before or after outflow)", () => {
    expect(detectTransferPairs([out, { ...inbound, date: "2026-09-08" }], WINDOW)).toHaveLength(1);
    expect(detectTransferPairs([out, { ...inbound, date: "2026-09-09" }], WINDOW)).toEqual([]);
    expect(detectTransferPairs([out, { ...inbound, date: "2026-08-31" }], WINDOW)).toHaveLength(1);
    expect(detectTransferPairs([out, { ...inbound, date: "2026-08-24" }], WINDOW)).toEqual([]);
  });

  it("each side pairs at most once, nearest date first", () => {
    const secondIn = { ...inbound, id: "in2", date: "2026-09-03", amount: -500 };
    const pairs = detectTransferPairs([out, inbound, secondIn], WINDOW);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.inId).toBe("in1");
  });

  it("requires exact amounts", () => {
    expect(detectTransferPairs([out, { ...inbound, amount: -499.99 }], WINDOW)).toEqual([]);
  });
});

describe("projectFinanceTransactions with linkedTransfers", () => {
  const rows = [
    txn({ id: "out1", amount: 500, date: "2026-09-01", pfc_primary: "SHOPPING", pfc_detailed: "Shopping" }),
    txn({ id: "in1", amount: -500, date: "2026-09-02", pfc_primary: "TRANSFER_IN", pfc_detailed: null }),
  ];

  it("both sides flow as transfer and stay in the ledger with real amounts", () => {
    const projected = projectFinanceTransactions({
      rows: rows.map(fromTransactionRow),
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
      linkedTransfers: [{ outTransactionId: "out1", inTransactionId: "in1" }],
    });
    expect(projected.map((row) => row.id).sort()).toEqual(["in1", "out1"]);
    for (const row of projected) expect(row.flow).toBe("transfer");
    const amounts = Object.fromEntries(projected.map((row) => [row.id, row.signedAmount]));
    expect(amounts).toEqual({ in1: -500, out1: 500 });
  });

  it("without the link the outflow counts as expense", () => {
    const projected = projectFinanceTransactions({
      rows: rows.map(fromTransactionRow),
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });
    expect(projected.find((row) => row.id === "out1")!.flow).toBe("expense");
  });

  it("composes with refunds without double-counting", () => {
    const projected = projectFinanceTransactions({
      rows: [
        ...rows,
        txn({ id: "chg1", amount: 80, pfc_primary: "SHOPPING", pfc_detailed: "Shopping" }),
        txn({ id: "ref1", amount: -80, pfc_primary: "REFUND", pfc_detailed: null }),
      ].map(fromTransactionRow),
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [{ chargeTransactionId: "chg1", refundTransactionId: "ref1" }],
      linkedTransfers: [{ outTransactionId: "out1", inTransactionId: "in1" }],
    });
    const flows = Object.fromEntries(projected.map((row) => [row.id, row.flow]));
    expect(flows).toEqual({ out1: "transfer", in1: "transfer", chg1: "transfer", ref1: "transfer" });
  });
});

describe("detectTransferPairs — deterministic tie-breaks", () => {
  it("pairs the lowest-id inflow when two arrive the same day", () => {
    const out = { id: "out1", date: "2026-09-01", merchant: "", amount: 500, accountId: "checking" };
    const inA = { id: "inA", date: "2026-09-02", merchant: "", amount: -500, accountId: "cardA" };
    const inB = { id: "inB", date: "2026-09-02", merchant: "", amount: -500, accountId: "cardB" };
    const pairs = detectTransferPairs([inB, out, inA], 7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.inId).toBe("inA");
  });

  it("sorts multiple outflows on the same date by id", () => {
    const outB = { id: "outB", date: "2026-09-01", merchant: "", amount: 500, accountId: "checking" };
    const outA = { id: "outA", date: "2026-09-01", merchant: "", amount: 500, accountId: "checking" };
    const in1 = { id: "in1", date: "2026-09-02", merchant: "", amount: -500, accountId: "cardA" };
    const pairs = detectTransferPairs([outB, outA, in1], 7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.outId).toBe("outA");
  });
});

