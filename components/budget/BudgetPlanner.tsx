"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import BudgetRightRail from "@/components/budget/BudgetRightRail";
import BudgetTable, {
  type BudgetLinePatch,
} from "@/components/budget/BudgetTable";
import Panel from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { formatCurrency, formatMonth } from "@/lib/format";
import type {
  BudgetLine,
  BudgetPageData,
  BudgetSeedProposal,
  BudgetSummaryTab,
  BudgetViewData,
} from "@/lib/budget-page";
import SeedBudgetButton from "@/components/budget/SeedBudgetButton";
import CopyLastMonthButton from "@/components/budget/CopyLastMonthButton";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function recalculate(
  data: BudgetPageData,
  budgetId: string,
  patch: BudgetLinePatch,
): BudgetPageData {
  const allLines = data.sections.flatMap((section) => section.lines);
  const nextLines = allLines.map((line) => {
    if (line.budgetId !== budgetId) return line;
    const group = patch.group ?? line.group;
    const basePlanned = patch.planned ?? line.basePlanned;
    const planned = Math.max(
      0,
      round2(basePlanned + line.rolloverCarry),
    );
    return {
      ...line,
      group,
      basePlanned,
      planned,
      remaining: round2(
        group === "income" ? line.actual - planned : planned - line.actual,
      ),
      rolloverEnabled:
        patch.rolloverEnabled ?? line.rolloverEnabled,
      sortOrder: patch.sortOrder ?? line.sortOrder,
    };
  });
  const sections = data.sections.map((section) => {
    const lines = nextLines
      .filter((line) => line.group === section.key)
      .toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.label.localeCompare(right.label),
      );
    const planned = round2(
      lines.reduce((total, line) => total + line.planned, 0),
    );
    const actual = round2(
      lines.reduce((total, line) => total + line.actual, 0),
    );
    return {
      ...section,
      lines,
      planned,
      actual,
      remaining: round2(
        section.key === "income" ? actual - planned : planned - actual,
      ),
      unbudgetedCount: lines.filter((line) => !line.budgeted).length,
    };
  });
  const income = sections.find((section) => section.key === "income")!;
  const expenses = sections.filter((section) => section.key !== "income");
  const expensePlanned = round2(
    expenses.reduce((total, section) => total + section.planned, 0),
  );
  const expenseActual = round2(
    expenses.reduce((total, section) => total + section.actual, 0),
  );
  const contributionsPlanned = round2(
    data.contributions.goals.reduce(
      (total, goal) => total + goal.planned,
      0,
    ),
  );
  return {
    ...data,
    sections,
    totalIncome: { planned: income.planned, actual: income.actual },
    totalExpenses: {
      planned: expensePlanned,
      actual: expenseActual,
      remaining: round2(expensePlanned - expenseActual),
    },
    leftToBudget: round2(
      income.planned - expensePlanned - contributionsPlanned,
    ),
  };
}

/** The grey strip grouping Income / Expenses / Contributions, each holding
 * one or more `BudgetTable`s. Column captions repeat Monarch's own layout;
 * not scroll-sticky (unlike the design's literal "sticky sub-header band")
 * — stacking several independently-sticky strips without knowing the
 * others' rendered heights risks them overlapping, which isn't something
 * this sandbox can visually verify, so this ships as a static band instead. */
function SuperBand({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex items-center justify-between rounded-card bg-panel-2 px-5 py-2.5">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <span className="hidden gap-10 text-xs font-bold uppercase tracking-wide text-muted sm:flex">
        <span className="w-20 text-right">Planned</span>
        <span className="w-20 text-right">Actual</span>
        <span className="w-24 text-right">Remaining</span>
      </span>
    </div>
  );
}

function TotalsRow({
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
  // Wraps below `sm` instead of overflowing. The three fixed-width columns plus
  // gap-6 need ~344px before the label, which does not fit a 390px phone.
  // SuperBand above solves the same problem by hiding its captions, but figures
  // cannot be hidden, so they wrap instead. The `sm:` widths keep the columns
  // aligned with SuperBand's captions at every size that still shows them.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-field bg-panel-2 px-5 py-3 text-sm font-bold">
      <span>{label}</span>
      <span className="flex flex-wrap justify-end gap-x-3 gap-y-1 sm:gap-6">
        <span data-money className="text-right sm:w-20">{formatCurrency(planned, currency)}</span>
        <span data-money className="text-right sm:w-20">{formatCurrency(actual, currency)}</span>
        <span
          data-money
          className="text-right sm:w-24"
          style={{ color: remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
        >
          {formatCurrency(remaining, currency)}
        </span>
      </span>
    </div>
  );
}

function YearTable({
  view,
  currency,
}: Readonly<{
  view: Extract<BudgetViewData, { horizon: "yearly" }>;
  currency: string;
}>) {
  return (
    <Panel title={`${view.year} monthly plan`} eyebrow="Year">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="font-mono">
              <th scope="col" className="py-3 text-left">Month</th>
              <th scope="col" className="py-3 text-right">Planned</th>
              <th scope="col" className="py-3 text-right">Actual</th>
              <th scope="col" className="py-3 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {view.months.map((month) => (
              <tr key={month.month} className="border-t border-panel-border">
                <th scope="row" className="py-3 text-left font-semibold font-mono">
                  {formatMonth(month.month)}
                </th>
                <td className="py-3 text-right">
                  {formatCurrency(month.totalExpenses.planned, currency)}
                </td>
                <td className="py-3 text-right">
                  {formatCurrency(month.totalExpenses.actual, currency)}
                </td>
                <td
                  data-money
                  className="py-3 text-right"
                  style={{ color: month.totalExpenses.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                >
                  {formatCurrency(month.totalExpenses.remaining, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DecadeTable({
  view,
  currency,
}: Readonly<{
  view: Extract<BudgetViewData, { horizon: "decade" }>;
  currency: string;
}>) {
  return (
    <Panel
      title={`${view.startYear} to ${view.startYear + 9}`}
      eyebrow="Decade"
    >
      {view.years.length === 0 ? (
        <p className="text-sm text-muted">
          No transaction or period history exists in this decade.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-muted">
              <tr className="font-mono">
                <th scope="col" className="py-3 text-left">Year</th>
                <th scope="col" className="py-3 text-right">Planned</th>
                <th scope="col" className="py-3 text-right">Actual</th>
                <th scope="col" className="py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {view.years.map((year) => (
                <tr key={year.year} className="border-t border-panel-border">
                  <th scope="row" className="py-3 text-left font-semibold font-mono">
                    {year.year}
                  </th>
                  <td className="py-3 text-right">
                    {formatCurrency(year.planned, currency)}
                  </td>
                  <td className="py-3 text-right">
                    {formatCurrency(year.actual, currency)}
                  </td>
                  <td
                    data-money
                    className="py-3 text-right"
                    style={{ color: year.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {formatCurrency(year.remaining, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function BudgetPlanner({
  initialView,
  proposals,
  month,
  currency,
  summaryTab,
  summaryLinks,
}: Readonly<{
  initialView: BudgetViewData;
  proposals: BudgetSeedProposal[];
  month: string;
  currency: string;
  summaryTab: BudgetSummaryTab;
  summaryLinks: Record<BudgetSummaryTab, string>;
}>) {
  const router = useRouter();
  const [monthlyData, setMonthlyData] = useState(
    initialView.horizon === "monthly" ? initialView.month : null,
  );
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  async function updateLine(line: BudgetLine, patch: BudgetLinePatch) {
    if (!line.budgetId || !monthlyData) return;
    const previous = monthlyData;
    const optimistic = recalculate(
      monthlyData,
      line.budgetId,
      patch,
    );
    setMonthlyData(optimistic);
    setSaving(true);
    setAnnouncement(`Saving ${line.label}.`);
    try {
      const response = await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget_id: line.budgetId,
          month,
          planned: patch.planned ?? line.basePlanned,
          ...(patch.group !== undefined
            ? { group_name: patch.group }
            : {}),
          ...(patch.rolloverEnabled !== undefined
            ? { rollover_enabled: patch.rolloverEnabled }
            : {}),
          ...(patch.sortOrder !== undefined
            ? { sort_order: patch.sortOrder }
            : {}),
        }),
      });
      if (!response.ok) throw new Error("budget_save_failed");
      setAnnouncement(`${line.label} saved.`);
      router.refresh();
    } catch {
      setMonthlyData(previous);
      setAnnouncement(
        `${line.label} was not saved. All totals were rolled back.`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (initialView.horizon === "yearly") {
    return <YearTable view={initialView} currency={currency} />;
  }
  if (initialView.horizon === "decade") {
    return <DecadeTable view={initialView} currency={currency} />;
  }
  if (!monthlyData) return null;

  const incomeSection = monthlyData.sections.find((section) => section.key === "income");
  const expenseSections = monthlyData.sections.filter((section) => section.key !== "income");
  const contributionsPlanned = round2(
    monthlyData.contributions.goals.reduce((total, goal) => total + goal.planned, 0),
  );
  const contributionsActual = round2(
    monthlyData.contributions.goals.reduce((total, goal) => total + goal.actual, 0),
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap justify-end gap-2">
            <CopyLastMonthButton month={month} />
            <SeedBudgetButton proposals={proposals} month={month} currency={currency} />
          </div>

          <div className="space-y-3">
            <SuperBand label="Income" />
            {incomeSection && (
              <BudgetTable
                section={incomeSection}
                currency={currency}
                disabled={saving}
                onUpdate={updateLine}
              />
            )}
            <TotalsRow
              label="Total Income"
              planned={monthlyData.totalIncome.planned}
              actual={monthlyData.totalIncome.actual}
              remaining={round2(monthlyData.totalIncome.actual - monthlyData.totalIncome.planned)}
              currency={currency}
            />
          </div>

          <div className="space-y-3">
            <SuperBand label="Expenses" />
            {expenseSections.map((section) => (
              <BudgetTable
                key={section.key}
                section={section}
                currency={currency}
                disabled={saving}
                onUpdate={updateLine}
              />
            ))}
            <TotalsRow
              label="Total Expenses"
              planned={monthlyData.totalExpenses.planned}
              actual={monthlyData.totalExpenses.actual}
              remaining={monthlyData.totalExpenses.remaining}
              currency={currency}
            />
          </div>

          <div className="space-y-3">
            <SuperBand label="Contributions" />
            <Panel eyebrow="Goals" title="Savings and payoff goals">
              {monthlyData.contributions.goals.length === 0 ? (
                <p className="text-sm text-muted">
                  Goal contribution events arrive in Phase 7. No contribution
                  activity is inferred from balance changes.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {monthlyData.contributions.goals.map((goal) => (
                    <li key={goal.name} className="flex justify-between gap-3">
                      <span>{goal.name}</span>
                      <span data-money>{formatCurrency(goal.actual, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {monthlyData.contributions.goals.length > 0 && (
              <TotalsRow
                label="Total Contributions"
                planned={contributionsPlanned}
                actual={contributionsActual}
                remaining={round2(contributionsPlanned - contributionsActual)}
                currency={currency}
              />
            )}
          </div>

          <div
            className={cn(
              "flex items-center justify-between rounded-card px-5 py-4 text-base font-bold",
              monthlyData.leftToBudget < 0 ? "bg-danger text-danger-foreground" : "bg-success text-success-foreground",
            )}
          >
            <span>Left to Budget</span>
            <span data-money>{formatCurrency(monthlyData.leftToBudget, currency)}</span>
          </div>
        </div>

        <BudgetRightRail
          data={monthlyData}
          currency={currency}
          tab={summaryTab}
          links={summaryLinks}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
