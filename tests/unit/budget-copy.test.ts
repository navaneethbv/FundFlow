import { describe, it, expect } from "vitest";
import {
  parseCopyBody,
  planCopy,
  previousMonth,
} from "@/lib/budget-copy";

describe("previousMonth", () => {
  it("steps back within a year", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
  });

  it("wraps January to December of the previous year", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("parseCopyBody", () => {
  it("accepts a month with no mode", () => {
    expect(parseCopyBody({ month: "2026-09" })).toEqual({
      ok: true,
      month: "2026-09",
      mode: undefined,
    });
  });

  it("accepts both explicit modes", () => {
    expect(parseCopyBody({ month: "2026-09", mode: "merge" })).toMatchObject({ mode: "merge" });
    expect(parseCopyBody({ month: "2026-09", mode: "overwrite" })).toMatchObject({
      mode: "overwrite",
    });
  });

  it("rejects bad months, modes, and payloads", () => {
    expect(parseCopyBody({ month: "2026-13" }).ok).toBe(false);
    expect(parseCopyBody({ month: "september" }).ok).toBe(false);
    expect(parseCopyBody({ month: "2026-09", mode: "replace" }).ok).toBe(false);
    expect(parseCopyBody(null).ok).toBe(false);
    expect(parseCopyBody("2026-09").ok).toBe(false);
  });
});

describe("planCopy", () => {
  const source = [
    { budget_id: "b1", planned: "250.00" },
    { budget_id: "b2", planned: 100 },
    { budget_id: "b3", planned: 40 },
  ];

  it("copies every source row when the target month is empty", () => {
    const plan = planCopy(source, []);
    expect(plan.rows).toEqual([
      { budgetId: "b1", planned: 250 },
      { budgetId: "b2", planned: 100 },
      { budgetId: "b3", planned: 40 },
    ]);
    expect(plan.conflicts).toBe(0);
    expect(plan.skipped).toBe(0);
  });

  it("merge fills only envelopes the target month is missing", () => {
    const plan = planCopy(source, [{ budget_id: "b2", planned: 999 }], "merge");
    expect(plan.rows).toEqual([
      { budgetId: "b1", planned: 250 },
      { budgetId: "b3", planned: 40 },
    ]);
    expect(plan.conflicts).toBe(1);
    expect(plan.skipped).toBe(1);
  });

  it("overwrite restates every source value", () => {
    const plan = planCopy(source, [{ budget_id: "b2", planned: 999 }], "overwrite");
    expect(plan.rows).toHaveLength(3);
    expect(plan.skipped).toBe(0);
  });

  it("skips non-numeric or negative source amounts instead of writing them", () => {
    const plan = planCopy(
      [
        { budget_id: "b1", planned: "abc" },
        { budget_id: "b2", planned: -5 },
      ],
      [],
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toBe(2);
  });
});
