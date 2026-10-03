import { describe, expect, it } from "vitest";
import {
  assessBalanceQuality,
  type QualityReading,
} from "@/lib/balance-quality";

const anchor: QualityReading = {
  date: "2026-09-30",
  balance: 2000,
  currency: "USD",
  holdings: null,
};
const reading = (balance: number | null): QualityReading => ({
  ...anchor,
  date: "2026-10-01",
  balance,
});

describe("balance quality signals", () => {
  it("does not invent an anchor for a first observation", () => {
    expect(assessBalanceQuality(reading(200000), null)).toEqual([]);
  });
  it("flags a large nearby jump without altering either observation", () => {
    const raw = reading(5000);
    expect(assessBalanceQuality(raw, anchor)).toEqual(["balance_jump"]);
    expect(raw.balance).toBe(5000);
    expect(anchor.balance).toBe(2000);
  });
  it("keeps ordinary changes and small balances out of the queue", () => {
    expect(assessBalanceQuality(reading(3900), anchor)).toEqual([]);
    expect(
      assessBalanceQuality(reading(100), { ...anchor, balance: 1 }),
    ).toEqual([]);
  });
  it("handles zero and negative anchors without division by zero", () => {
    expect(
      assessBalanceQuality(reading(1000), { ...anchor, balance: 0 }),
    ).toEqual(["balance_jump"]);
    expect(
      assessBalanceQuality(reading(1000), { ...anchor, balance: -2000 }),
    ).toEqual(["balance_jump"]);
  });
  it("does not compare different currencies or distant dates", () => {
    expect(
      assessBalanceQuality({ ...reading(5000), currency: "EUR" }, anchor),
    ).toEqual([]);
    expect(
      assessBalanceQuality(reading(5000), { ...anchor, date: "2026-08-01" }),
    ).toEqual([]);
    expect(
      assessBalanceQuality(reading(5000), { ...anchor, date: "2026-10-02" }),
    ).toEqual([]);
  });
  it("distinguishes a missing reading from an observed zero", () => {
    expect(assessBalanceQuality(reading(null), anchor)).toEqual([
      "missing_balance",
    ]);
    expect(assessBalanceQuality(reading(0), anchor)).toEqual(["balance_jump"]);
    expect(
      assessBalanceQuality(reading(5000), { ...anchor, balance: null }),
    ).toEqual([]);
  });
  it("flags emptied holdings only when both observations include holdings", () => {
    const prior = {
      ...anchor,
      holdings: [{ id: "security-a", quantity: 20, price: 100, value: 2000 }],
    };
    expect(
      assessBalanceQuality({ ...reading(2000), holdings: [] }, prior),
    ).toEqual(["empty_holdings"]);
    expect(assessBalanceQuality(reading(2000), prior)).toEqual([]);
    expect(
      assessBalanceQuality({ ...reading(2000), holdings: [] }, anchor),
    ).toEqual([]);
  });
  it("matches prices by security id and preserves genuine changes for review", () => {
    const prior = {
      ...anchor,
      holdings: [
        { id: "a", quantity: 20, price: 100, value: 2000 },
        { id: "b", quantity: 10, price: 100, value: 1000 },
      ],
    };
    const raw = {
      ...reading(2000),
      holdings: [
        { id: "b", quantity: 10, price: 100, value: 1000 },
        { id: "a", quantity: 20, price: 300, value: 6000 },
      ],
    };
    expect(assessBalanceQuality(raw, prior)).toEqual(["holding_price_jump"]);
    expect(raw.holdings[1]!.price).toBe(300);
  });
  it("does not flag an offsetting stock split as a price jump", () => {
    const prior = {
      ...anchor,
      holdings: [{ id: "a", quantity: 20, price: 100, value: 2000 }],
    };
    expect(
      assessBalanceQuality(
        {
          ...reading(2000),
          holdings: [{ id: "a", quantity: 10, price: 200, value: 2000 }],
        },
        prior,
      ),
    ).toEqual([]);
  });
  it("does not compare missing or zero unit prices or unrelated securities", () => {
    const prior = {
      ...anchor,
      holdings: [
        { id: "a", quantity: 20, price: 0, value: 2000 },
        { id: "b", quantity: 20, price: null, value: 2000 },
      ],
    };
    const raw = {
      ...reading(2000),
      holdings: [
        { id: "a", quantity: 20, price: 100, value: 2000 },
        { id: "b", quantity: 20, price: 100, value: 2000 },
        { id: "c", quantity: 20, price: 500, value: 10000 },
      ],
    };
    expect(assessBalanceQuality(raw, prior)).toEqual([]);
  });
});
it("does not promote unavailable position values or malformed calendar dates into a review", () => {
  const prior = {
    ...anchor,
    holdings: [{ id: "a", quantity: 20, price: 10, value: null }],
  };
  expect(
    assessBalanceQuality(
      {
        ...reading(2000),
        holdings: [{ id: "a", quantity: 20, price: 100, value: 2000 }],
      },
      prior,
    ),
  ).toEqual([]);
  expect(
    assessBalanceQuality({ ...reading(2000), holdings: [] }, prior),
  ).toEqual([]);
  expect(
    assessBalanceQuality({ ...reading(5000), date: "2026-02-30" }, anchor),
  ).toEqual([]);
});
