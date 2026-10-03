import Panel from "@/components/ui/Panel";
import ProgressBar from "@/components/ui/ProgressBar";
import Tabs from "@/components/ui/Tabs";
import { formatCurrency } from "@/lib/format";
import { assessBudgetAllocation } from "@/lib/budget-allocation";
import type { BudgetPageData, BudgetGroup, BudgetSummaryTab } from "@/lib/budget-page";

const EXPENSE_GROUPS = new Set<BudgetGroup>(["fixed", "flexible", "non_monthly"]);

/** 7.2: shown only when the month allocates more than its planned income. */
function AllocationWarning({ data, currency }: Readonly<{ data: BudgetPageData; currency: string }>) {
  const allocation = assessBudgetAllocation({
    incomePlanned: data.totalIncome.planned,
    expensesPlanned: data.totalExpenses.planned,
    contributionsPlanned: data.contributions.goals.reduce((total, goal) => total + goal.planned, 0),
  });
  if (allocation.status === "within") return null;
  if (allocation.status === "no_income") {
    return (
      <Panel tone="warning" title="Add an income budget">
        <p className="text-sm text-muted">
          Budget your expected income to check whether this month allocates more than you earn.
        </p>
      </Panel>
    );
  }
  return (
    <Panel tone="danger" title="Budget exceeds planned income">
      <p role="status" className="text-sm text-muted">
        This month allocates <span data-money>{formatCurrency(allocation.allocated, currency)}</span> against{" "}
        <span data-money>{formatCurrency(allocation.expectedIncome, currency)}</span> of planned income,{" "}
        <span data-money>{formatCurrency(allocation.overBy, currency)}</span> over. Lower a category or move money between categories.
      </p>
    </Panel>
  );
}

function GroupMiniSummary({
  label,
  planned,
  actual,
  remaining,
  currency,
}: Readonly<{
  label: string;
  planned: number;
  actual: number;
  remaining: number;
  currency: string;
}>) {
  const pct = planned > 0 ? Math.round((actual / planned) * 100) : 0;
  const over = remaining < 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span data-money className="text-xs text-muted">
          {formatCurrency(planned, currency)} planned
        </span>
      </div>
      <ProgressBar
        className="mt-2"
        size="sm"
        percent={pct}
        tone={over ? "danger" : "accent"}
        ariaLabel={`${label} spent`}
      />
      <p className="mt-1.5 text-xs text-muted">
        <span data-money>{formatCurrency(actual, currency)} spent</span> ·{" "}
        <span data-money style={{ color: over ? "var(--viz-neg)" : "var(--viz-pos)" }}>
          {formatCurrency(remaining, currency)} remaining
        </span>
      </p>
    </div>
  );
}

/**
 * Monarch's right rail: a big tinted "Left to budget" figure, a Summary/
 * Income/Expenses tab switch (the same URL-driven tabs that used to render
 * as a row of stat cards above the table — this replaces that grid rather
 * than duplicating it), and a per-group mini-summary underneath. Every
 * figure the old 4-card grid showed is still here: Left to Budget in the
 * hero, Planned/Actual Income and Expenses under their tabs, and Monthly
 * Sinking Funds as a line in the Summary tab.
 */
export default function BudgetRightRail({
  data,
  currency,
  tab,
  links,
  allocationWarning = false,
}: Readonly<{
  allocationWarning?: boolean;
  data: BudgetPageData;
  currency: string;
  tab: BudgetSummaryTab;
  links: Record<BudgetSummaryTab, string>;
}>) {
  const negative = data.leftToBudget < 0;
  const expenseGroups = data.sections.filter((section) =>
    EXPENSE_GROUPS.has(section.key),
  );

  return (
    <div className="space-y-4 lg:sticky lg:top-5">
      <Panel tone={negative ? "danger" : "success"} className="text-center">
        <p
          data-money
          className="metric-value text-3xl"
          style={{ color: negative ? "var(--viz-neg)" : "var(--viz-pos)" }}
        >
          {formatCurrency(data.leftToBudget, currency)}
        </p>
        <p className="mt-1 text-sm font-semibold text-muted">Left to budget</p>
      </Panel>

      {allocationWarning && <AllocationWarning data={data} currency={currency} />}

      <Panel padding="none">
        <div className="px-2 pt-2">
          <Tabs
            items={(["summary", "income", "expenses"] as const).map((key) => ({
              label: key.charAt(0).toUpperCase() + key.slice(1),
              href: links[key],
              active: tab === key,
            }))}
          />
        </div>
        <div className="space-y-4 p-4">
          {tab === "income" && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Planned income</span>
                <span data-money className="font-semibold">
                  {formatCurrency(data.totalIncome.planned, currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Actual income</span>
                <span data-money className="font-semibold">
                  {formatCurrency(data.totalIncome.actual, currency)}
                </span>
              </div>
            </>
          )}

          {tab === "expenses" && (
            <>
              {/* Planned and Actual mirror the Income tab above. They were
                  dropped when the 4-card stat grid became these tabs, which
                  left Expenses showing only a remainder — and left "Actual
                  expenses", the figure that reconciles this page against Cash
                  Flow, with nowhere to appear. */}
              <div className="flex justify-between text-sm">
                <span className="text-muted">Planned expenses</span>
                <span data-money className="font-semibold">
                  {formatCurrency(data.totalExpenses.planned, currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Actual expenses</span>
                <span data-money className="font-semibold">
                  {formatCurrency(data.totalExpenses.actual, currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Expense remaining</span>
                <span
                  data-money
                  className="font-semibold"
                  style={{ color: data.totalExpenses.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                >
                  {formatCurrency(data.totalExpenses.remaining, currency)}
                </span>
              </div>
            </>
          )}

          {tab === "summary" && data.sinkingFundsTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Monthly sinking funds</span>
              <span data-money className="font-semibold">
                {formatCurrency(data.sinkingFundsTotal, currency)}
              </span>
            </div>
          )}

          {tab !== "income" &&
            expenseGroups.map((section) => (
              <GroupMiniSummary
                key={section.key}
                label={section.label}
                planned={section.planned}
                actual={section.actual}
                remaining={section.remaining}
                currency={currency}
              />
            ))}
        </div>
      </Panel>
    </div>
  );
}
