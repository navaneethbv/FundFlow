import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BudgetWidget from "@/components/dashboard/widgets/BudgetWidget";
import GoalsWidget from "@/components/dashboard/widgets/GoalsWidget";
import InvestmentsWidget from "@/components/dashboard/widgets/InvestmentsWidget";
import NetWorthWidget from "@/components/dashboard/widgets/NetWorthWidget";
import RecurringWidget, {
  withinNextSevenDays,
  type UpcomingRecurringItem,
} from "@/components/dashboard/widgets/RecurringWidget";
import SpendingCompareWidget from "@/components/dashboard/widgets/SpendingCompareWidget";
import TransactionsWidget from "@/components/dashboard/widgets/TransactionsWidget";
import DashboardWidgetGrid from "@/components/dashboard/DashboardWidgetGrid";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { DEFAULT_WIDGET_ORDER } from "@/lib/dashboard-widgets";
import type { BudgetEnvelope } from "@/lib/planning";
import type { DashboardBudgetGroup } from "@/lib/dashboard-budget-groups";

/**
 * Widgets are server-rendered, so markup is the regression net for their
 * distinct states. The one that matters most is the difference between "no data
 * yet" and "this failed to load": collapsing those into one message is how a
 * broken query starts looking like an empty account.
 */

function envelope(partial: Partial<BudgetEnvelope> = {}): BudgetEnvelope {
  return {
    category: "groceries",
    monthlyLimit: 500,
    spent: 200,
    remaining: 300,
    projectedSpend: 400,
    status: "on-track",
    lastMonthSpend: 450,
    threeMonthAverage: 430,
    carry: 0,
    ...partial,
  } as BudgetEnvelope;
}

function budgetGroup(
  partial: Partial<DashboardBudgetGroup> = {},
): DashboardBudgetGroup {
  return {
    key: "flexible",
    label: "Flexible",
    monthlyLimit: 500,
    spent: 200,
    remaining: 300,
    status: "on-track",
    ...partial,
  };
}

describe("WidgetShell states", () => {
  it("shows an error instead of the body, and distinctly from empty", () => {
    const errored = renderToStaticMarkup(
      createElement(WidgetShell, { title: "T", error: "Could not load" }, "BODY"),
    );
    expect(errored).toContain("Could not load");
    expect(errored).not.toContain("BODY");

    const empty = renderToStaticMarkup(
      createElement(WidgetShell, { title: "T", empty: "Nothing yet" }, "BODY"),
    );
    expect(empty).toContain("Nothing yet");
    expect(empty).not.toContain("BODY");
    // The two states must not read alike.
    expect(empty).not.toContain("Could not load");
  });

  it("renders children when neither state applies", () => {
    expect(
      renderToStaticMarkup(createElement(WidgetShell, { title: "T" }, "BODY")),
    ).toContain("BODY");
  });

  it("flags stale data without hiding the body", () => {
    const html = renderToStaticMarkup(
      createElement(WidgetShell, { title: "T", stale: true }, "BODY"),
    );
    expect(html).toContain("last successful sync");
    expect(html).toContain("BODY");
  });

  it("prefers the error message over the stale notice", () => {
    const html = renderToStaticMarkup(
      createElement(WidgetShell, { title: "T", stale: true, error: "Broke" }, "BODY"),
    );
    expect(html).toContain("Broke");
    expect(html).not.toContain("last successful sync");
  });
});

describe("BudgetWidget", () => {
  it("wraps the spent/limit figure in the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetWidget, {
        currency: "USD",
        groups: [
          budgetGroup({
            key: "flexible",
            label: "Dining Out",
            spent: 128,
            monthlyLimit: 100,
            status: "over",
          }),
        ],
      }),
    );
    expect(html).toContain("data-money");
  });

  it("renders fixed, flexible, and non-monthly groups in planning order", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetWidget, {
        currency: "USD",
        groups: [
          budgetGroup({ key: "fixed", label: "Fixed", status: "over" }),
          budgetGroup(),
          budgetGroup({ key: "non_monthly", label: "Non-monthly", status: "at-risk" }),
        ],
      }),
    );
    expect(html.indexOf("Fixed")).toBeLessThan(html.indexOf("Flexible"));
    expect(html.indexOf("Flexible")).toBeLessThan(html.indexOf("Non-monthly"));
  });

  it("names the status in the bar's label, so colour is not the only cue", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetWidget, {
        currency: "USD",
        groups: [budgetGroup({ status: "over", spent: 900 })],
      }),
    );
    expect(html).toContain("of budget used, over");
  });

  it("has an empty state when nothing is budgeted", () => {
    expect(
      renderToStaticMarkup(
        createElement(BudgetWidget, { currency: "USD", groups: [] }),
      ),
    ).toContain("No budgets set");
  });
});

describe("NetWorthWidget", () => {
  it("shows the latest value and the month-on-month change", () => {
    const html = renderToStaticMarkup(
      createElement(NetWorthWidget, {
        currency: "USD",
        history: [
          { month: "2026-06", netWorth: 1000 },
          { month: "2026-07", netWorth: 1500 },
        ],
      }),
    );
    expect(html).toContain("Up");
    expect(html).toContain("in the last month");
  });

  it("claims no change from a single data point", () => {
    const html = renderToStaticMarkup(
      createElement(NetWorthWidget, {
        currency: "USD",
        history: [{ month: "2026-07", netWorth: 1500 }],
      }),
    );
    expect(html).not.toContain("in the last month");
  });

  it("has an empty state with no history at all", () => {
    expect(
      renderToStaticMarkup(
        createElement(NetWorthWidget, { currency: "USD", history: [] }),
      ),
    ).toContain("Connect an account");
  });
});

describe("RecurringWidget", () => {
  const items: UpcomingRecurringItem[] = [
    { name: "Rent", amount: 1200, nextDate: "2026-07-18", status: "expected" },
    { name: "Gym", amount: 40, nextDate: "2026-07-16", status: "paid" },
    { name: "Old", amount: 10, nextDate: "2026-07-01", status: "late" },
    { name: "Far", amount: 10, nextDate: "2026-08-30", status: "expected" },
  ];

  it("keeps only the next seven days, soonest first", () => {
    const within = withinNextSevenDays(items, "2026-07-15");
    expect(within.map((item) => item.name)).toEqual(["Gym", "Rent"]);
  });

  it("includes both boundary days", () => {
    const boundary: UpcomingRecurringItem[] = [
      { name: "Today", amount: 1, nextDate: "2026-07-15", status: "expected" },
      { name: "Day7", amount: 1, nextDate: "2026-07-22", status: "expected" },
      { name: "Day8", amount: 1, nextDate: "2026-07-23", status: "expected" },
    ];
    expect(
      withinNextSevenDays(boundary, "2026-07-15").map((item) => item.name),
    ).toEqual(["Today", "Day7"]);
  });

  it("crosses a month boundary", () => {
    const crossing: UpcomingRecurringItem[] = [
      { name: "Next month", amount: 1, nextDate: "2026-08-02", status: "expected" },
    ];
    expect(withinNextSevenDays(crossing, "2026-07-30")).toHaveLength(1);
  });

  it("spells out each state rather than relying on colour", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringWidget, {
        items,
        today: "2026-07-15",
        currency: "USD",
      }),
    );
    expect(html).toContain("Paid");
    expect(html).toContain("Due");
  });

  it("labels an unusual amount instead of calling it paid", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringWidget, {
        items: [
          { name: "Water", amount: 90, nextDate: "2026-07-16", status: "unusual_amount" },
        ],
        today: "2026-07-15",
        currency: "USD",
      }),
    );
    expect(html).toContain("Check amount");
  });

  it("has an empty state for a quiet week", () => {
    expect(
      renderToStaticMarkup(
        createElement(RecurringWidget, {
          items: [],
          today: "2026-07-15",
          currency: "USD",
        }),
      ),
    ).toContain("Nothing due");
  });
});

describe("InvestmentsWidget", () => {
  it("shows the Phase 9A empty state until holdings exist", () => {
    const html = renderToStaticMarkup(
      createElement(InvestmentsWidget, { currency: "USD" }),
    );
    expect(html).toContain("Sync another account");
  });

  it("shows the total, day change, and top movers", () => {
    const html = renderToStaticMarkup(
      createElement(InvestmentsWidget, {
        currency: "USD",
        summary: {
          total: 10000,
          dayChange: { amount: 50, pct: 0.5 },
          topMovers: [
            { id: "holding-1", name: "Fund A", ticker: "FUNDA", changePct: 2.5 },
          ],
        },
      }),
    );
    expect(html).toContain("$10,000");
    expect(html).toContain("+$50.00 today");
    expect(html).toContain("Fund A");
    expect(html).toContain("+2.5%");
  });
});

describe("SpendingCompareWidget and TransactionsWidget and GoalsWidget", () => {
  it("SpendingCompareWidget renders the chart when there is spend", () => {
    const html = renderToStaticMarkup(
      createElement(SpendingCompareWidget, {
        days: [{ day: 1, thisMonth: 50, lastMonth: 20 }],
        monthLabel: "July",
        previousMonthLabel: "June",
      }),
    );
    expect(html).toContain("View data table");
  });

  it("SpendingCompareWidget is empty when both months are zero", () => {
    const html = renderToStaticMarkup(
      createElement(SpendingCompareWidget, {
        days: [{ day: 1, thisMonth: 0, lastMonth: 0 }],
        monthLabel: "July",
        previousMonthLabel: "June",
      }),
    );
    expect(html).toContain("No spending recorded");
  });

  it("TransactionsWidget defers to RecentActivity's own empty state", () => {
    const html = renderToStaticMarkup(
      createElement(TransactionsWidget, {
        transactions: [],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain("No recent activity yet.");
  });

  it("GoalsWidget defers to GoalsSummary's own empty state", () => {
    const html = renderToStaticMarkup(createElement(GoalsWidget, { goals: [] }));
    expect(html).toContain("No savings goals yet.");
  });
});

describe("DashboardWidgetGrid", () => {
  const baseProps = {
    data: {
      budgetEnvelopes: [envelope()],
      budgetGroups: [budgetGroup()],
      netWorthHistory: [{ month: "2026-07", netWorth: 100 }],
      recurringStatuses: [],
      investments: null,
    },
    goals: [],
    cumulativeSpend: [{ day: 1, thisMonth: 10, lastMonth: 5 }],
    monthLabel: "July",
    previousMonthLabel: "June",
    recentTransactions: [],
    accountNames: new Map<string, string>(),
    today: "2026-07-15",
  };

  it("renders every widget in the saved order", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWidgetGrid, {
        ...baseProps,
        prefs: { order: ["goals", "budget"], hidden: [] },
      }),
    );
    expect(html.indexOf("Goals")).toBeLessThan(html.indexOf("Budget"));
  });

  it("omits hidden widgets", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWidgetGrid, {
        ...baseProps,
        prefs: { order: [...DEFAULT_WIDGET_ORDER], hidden: ["investments"] },
      }),
    );
    expect(html).not.toContain("Sync another account");
  });

  it("splits widgets into Monarch's fixed left/right columns, not the saved order", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWidgetGrid, {
        ...baseProps,
        prefs: { order: ["spendingCompare", "goals", "budget"], hidden: [] },
      }),
    );
    const leftColumn = html.slice(
      html.indexOf('data-dashboard-column="left"'),
      html.indexOf('data-dashboard-column="right"'),
    );
    const rightColumn = html.slice(html.indexOf('data-dashboard-column="right"'));
    // goals/budget are left-column widgets regardless of where they sit in
    // the saved order relative to a right-column widget like spendingCompare.
    expect(leftColumn).toContain("Goals");
    expect(leftColumn).toContain("Budget");
    expect(leftColumn).not.toContain("View data table");
    expect(rightColumn).toContain("View data table");
  });

  it("preserves the saved order within a single column", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWidgetGrid, {
        ...baseProps,
        prefs: { order: ["netWorth", "goals", "budget"], hidden: [] },
      }),
    );
    expect(html.indexOf("Net worth")).toBeLessThan(html.indexOf("Goals"));
    expect(html.indexOf("Goals")).toBeLessThan(html.indexOf("Budget"));
  });

  it("explains itself when the user has hidden everything", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWidgetGrid, {
        ...baseProps,
        prefs: { order: [...DEFAULT_WIDGET_ORDER], hidden: [...DEFAULT_WIDGET_ORDER] },
      }),
    );
    expect(html).toContain("Every widget is hidden");
  });
});
