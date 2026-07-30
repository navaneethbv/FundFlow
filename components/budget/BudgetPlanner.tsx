"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import BudgetSummary, {
  type BudgetSummaryTab,
} from "@/components/budget/BudgetSummary";
import BudgetTable, {
  type BudgetLinePatch,
} from "@/components/budget/BudgetTable";
import Panel from "@/components/ui/Panel";
import { formatCurrency, formatMonth } from "@/lib/format";
import type {
  BudgetLine,
  BudgetPageData,
  BudgetSeedProposal,
  BudgetViewData,
} from "@/lib/budget-page";
import SeedBudgetButton from "@/components/budget/SeedBudgetButton";

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

function SummaryTabs({
  active,
  links,
}: Readonly<{
  active: BudgetSummaryTab;
  links: Record<BudgetSummaryTab, string>;
}>) {
  return (
    <nav aria-label="Budget summary" className="flex flex-wrap gap-2">
      {(["summary", "income", "expenses"] as const).map((tab) => (
        <Link
          key={tab}
          href={links[tab]}
          aria-current={tab === active ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-field px-4 text-sm font-semibold capitalize ${
            tab === active
              ? "bg-accent text-accent-foreground"
              : "bg-panel text-muted hover:text-foreground"
          }`}
        >
          {tab}
        </Link>
      ))}
    </nav>
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
            <tr>
              <th scope="col" className="py-3 text-left">Month</th>
              <th scope="col" className="py-3 text-right">Planned</th>
              <th scope="col" className="py-3 text-right">Actual</th>
              <th scope="col" className="py-3 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {view.months.map((month) => (
              <tr key={month.month} className="border-t border-panel-border">
                <th scope="row" className="py-3 text-left font-semibold">
                  {formatMonth(month.month)}
                </th>
                <td className="py-3 text-right">
                  {formatCurrency(month.totalExpenses.planned, currency)}
                </td>
                <td className="py-3 text-right">
                  {formatCurrency(month.totalExpenses.actual, currency)}
                </td>
                <td className="py-3 text-right">
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
              <tr>
                <th scope="col" className="py-3 text-left">Year</th>
                <th scope="col" className="py-3 text-right">Planned</th>
                <th scope="col" className="py-3 text-right">Actual</th>
                <th scope="col" className="py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {view.years.map((year) => (
                <tr key={year.year} className="border-t border-panel-border">
                  <th scope="row" className="py-3 text-left font-semibold">
                    {year.year}
                  </th>
                  <td className="py-3 text-right">
                    {formatCurrency(year.planned, currency)}
                  </td>
                  <td className="py-3 text-right">
                    {formatCurrency(year.actual, currency)}
                  </td>
                  <td className="py-3 text-right">
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SummaryTabs active={summaryTab} links={summaryLinks} />
        <SeedBudgetButton
          proposals={proposals}
          month={month}
          currency={currency}
        />
      </div>
      <BudgetSummary
        data={monthlyData}
        currency={currency}
        tab={summaryTab}
      />
      {monthlyData.sections.map((section) => (
        <BudgetTable
          key={section.key}
          section={section}
          currency={currency}
          disabled={saving}
          onUpdate={updateLine}
        />
      ))}
      <Panel title="Contributions" eyebrow="Goals">
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
                <span>{formatCurrency(goal.actual, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
