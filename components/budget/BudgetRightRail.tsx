import Panel from "@/components/ui/Panel";
import ProgressBar from "@/components/ui/ProgressBar";
import Tabs from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import type { BudgetPageData, BudgetGroup, BudgetSummaryTab } from "@/lib/budget-page";

const EXPENSE_GROUPS: BudgetGroup[] = ["fixed", "flexible", "non_monthly"];

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
        <span data-money className={over ? "text-danger" : undefined}>
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
}: Readonly<{
  data: BudgetPageData;
  currency: string;
  tab: BudgetSummaryTab;
  links: Record<BudgetSummaryTab, string>;
}>) {
  const negative = data.leftToBudget < 0;
  const expenseGroups = data.sections.filter((section) =>
    EXPENSE_GROUPS.includes(section.key),
  );

  return (
    <div className="space-y-4 lg:sticky lg:top-5">
      <Panel tone={negative ? "danger" : "success"} className="text-center">
        <p
          data-money
          className={cn("metric-value text-3xl", negative ? "text-danger" : "text-success")}
        >
          {formatCurrency(data.leftToBudget, currency)}
        </p>
        <p className="mt-1 text-sm font-semibold text-muted">Left to budget</p>
      </Panel>

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
            <div className="flex justify-between text-sm">
              <span className="text-muted">Expense remaining</span>
              <span
                data-money
                className={cn(
                  "font-semibold",
                  data.totalExpenses.remaining < 0 ? "text-danger" : "text-foreground",
                )}
              >
                {formatCurrency(data.totalExpenses.remaining, currency)}
              </span>
            </div>
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
