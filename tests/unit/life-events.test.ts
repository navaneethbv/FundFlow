import { describe, expect, it } from "vitest";
import {
  applyLifeEvents,
  parseLifeEvent,
  type LifeEvent,
  type ForecastPoint,
} from "@/lib/life-events";

function basePoints(n: number): ForecastPoint[] {
  return Array.from({ length: n }, (_, index) => ({
    month: `Month ${index + 1}`,
    conservative: 10000 + index * 200,
    base: 10000 + index * 250,
    optimistic: 10000 + index * 300,
  }));
}

describe("parseLifeEvent", () => {
  it("accepts a valid typed event", () => {
    const parsed = parseLifeEvent({
      type: "home_purchase",
      startMonth: 6,
      amount: 50000,
      durationMonths: null,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.type).toBe("home_purchase");
  });

  it("rejects unknown types, bad months, and non-positive amounts", () => {
    expect(parseLifeEvent({ type: "lottery", startMonth: 1, amount: 100 }).ok).toBe(false);
    expect(parseLifeEvent({ type: "child", startMonth: 0, amount: 100 }).ok).toBe(false);
    expect(parseLifeEvent({ type: "child", startMonth: 1, amount: -10 }).ok).toBe(false);
    expect(parseLifeEvent({ type: "child", startMonth: 1, amount: "x" }).ok).toBe(false);
  });
});

describe("applyLifeEvents", () => {
  it("leaves the projection unchanged without events", () => {
    expect(applyLifeEvents(basePoints(3), [], 500)).toEqual(basePoints(3));
  });

  it("applies a one-off home purchase once at its start month", () => {
    const events: LifeEvent[] = [{ type: "home_purchase", startMonth: 2, amount: 50000, durationMonths: null }];
    const result = applyLifeEvents(basePoints(3), events, 500);
    expect(result[0].base).toBe(10000);
    expect(result[1].base).toBe(10000 + 250 - 50000);
    expect(result[2].base).toBe(10000 + 500 - 50000);
  });

  it("applies a child expense for its duration only", () => {
    const events: LifeEvent[] = [{ type: "child", startMonth: 1, amount: 1000, durationMonths: 2 }];
    const result = applyLifeEvents(basePoints(4), events, 500);
    expect(result[0].base).toBe(10000 - 1000);
    expect(result[1].base).toBe(10000 + 250 - 1000);
    expect(result[2].base).toBe(10000 + 500); // duration over
  });

  it("applies an income change permanently from its start month", () => {
    const events: LifeEvent[] = [{ type: "income_change", startMonth: 2, amount: 1000, durationMonths: null }];
    const result = applyLifeEvents(basePoints(3), events, 500);
    expect(result[0].base).toBe(10000);
    expect(result[1].base).toBe(10000 + 250 + 1000);
  });

  it("applies an expense change and stops retirement savings contributions", () => {
    const expense: LifeEvent[] = [{ type: "expense_change", startMonth: 1, amount: 300, durationMonths: null }];
    expect(applyLifeEvents(basePoints(2), expense, 500)[1].base).toBe(10000 + 250 - 300);

    const retirement: LifeEvent[] = [{ type: "retirement", startMonth: 2, amount: 0, durationMonths: null }];
    expect(applyLifeEvents(basePoints(3), retirement, 500)[1].base).toBe(10000 + 250 - 500);
  });

  it("stacks multiple events cumulatively", () => {
    const events: LifeEvent[] = [
      { type: "income_change", startMonth: 1, amount: 1000, durationMonths: null },
      { type: "expense_change", startMonth: 1, amount: 400, durationMonths: null },
    ];
    const result = applyLifeEvents(basePoints(2), events, 500);
    expect(result[1].base).toBe(10000 + 250 + 600);
  });
});