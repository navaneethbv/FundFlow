import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecurringCalendar, {
  moveDayFocus,
  buildMonthGrid,
} from "@/components/recurring/RecurringCalendar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const occurrence = (over: Partial<{ dueDate: string; amount: number; status: "upcoming" | "overdue" | "complete"; isIncome: boolean; merchant: string }>) => ({
  source: "plaid" as const,
  sourceId: "s-1",
  merchant: "Netflix",
  frequency: "monthly",
  dueDate: "2026-08-15",
  account: "Checking",
  category: "ENTERTAINMENT",
  amount: 15.99,
  status: "upcoming" as const,
  matchedTransactionId: null,
  isIncome: false,
  evidenceCount: null as number | null,
  ...over,
});

describe("buildMonthGrid", () => {
  it("builds a Sunday-first grid covering the month", () => {
    const grid = buildMonthGrid("2026-08");
    expect(grid).toHaveLength(6);
    expect(grid[0]).toHaveLength(7);
    expect(grid.flat().map((cell) => cell.day)).toContain(15);
    // In-month cells are real August dates; the few padding cells belong to
    // adjacent months and are flagged inMonth=false.
    const inMonth = grid.flat().filter((cell) => cell.inMonth);
    expect(inMonth.every((cell) => cell.date.startsWith("2026-08-"))).toBe(true);
    expect(inMonth).toHaveLength(31);
  });
});

describe("moveDayFocus", () => {
  it("moves within the month and clamps at the edges", () => {
    const last = new Date("2026-08-31T00:00:00Z");
    const first = new Date("2026-08-01T00:00:00Z");
    expect(moveDayFocus(15, "ArrowLeft", first, last)).toBe(14);
    expect(moveDayFocus(15, "ArrowRight", first, last)).toBe(16);
    expect(moveDayFocus(15, "ArrowUp", first, last)).toBe(8);
    expect(moveDayFocus(15, "ArrowDown", first, last)).toBe(22);
    expect(moveDayFocus(1, "ArrowLeft", first, last)).toBe(1);
    expect(moveDayFocus(31, "ArrowRight", first, last)).toBe(31);
  });
});

describe("RecurringCalendar", () => {
  it("renders an accessible grid, occurrence markers, and a table twin", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringCalendar, {
        month: "2026-08",
        today: "2026-08-15",
        currency: "USD",
        occurrences: [
          occurrence({ merchant: "Netflix", dueDate: "2026-08-15", status: "upcoming", isIncome: false }),
          occurrence({ merchant: "Salary", dueDate: "2026-08-05", status: "complete", isIncome: true }),
          occurrence({ merchant: "Rent", dueDate: "2026-08-02", status: "overdue", isIncome: false }),
        ],
      }),
    );
    expect(html).toContain('role="grid"');
    expect(html).toContain('role="gridcell"');
    expect(html.match(/role="row"/g)).toHaveLength(7);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('data-calendar-date="2026-08-15"');
    expect(html).toContain("Netflix");
    expect(html).toContain("Salary");
    expect(html).toContain("Rent");
    expect(html).toContain("overdue");
    expect(html).toContain("Income");
    // The table twin lists every occurrence with its date.
    expect(html).toContain("<table");
    expect(html).toContain("2026-08-15");
    // No raw transaction or item identifiers leak into markup.
    expect(html).not.toContain("s-1");
  });
});

describe("inferred provenance in the accessible table twin", () => {
  it("names the detected source and count beside the merchant", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringCalendar, {
        month: "2026-08",
        today: "2026-08-15",
        currency: "USD",
        occurrences: [
          {
            ...occurrence({ merchant: "City Water", dueDate: "2026-08-15" }),
            source: "inferred" as const,
            evidenceCount: 3,
          },
        ],
      }),
    );
    expect(html).toContain("Detected from 3 transactions");
  });

  it("adds no provenance for a Plaid occurrence", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringCalendar, {
        month: "2026-08",
        today: "2026-08-15",
        currency: "USD",
        occurrences: [occurrence({ merchant: "Netflix", dueDate: "2026-08-15" })],
      }),
    );
    expect(html).not.toContain("Detected from");
  });
});
