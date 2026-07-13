import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard";
import type { Goal } from "@/lib/goals";
import { formatCurrency, titleCase } from "@/lib/format";
import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import GoalsSummary from "@/components/dashboard/GoalsSummary";
import PlanningDepth from "@/components/dashboard/PlanningDepth";

type PlanData = Pick<
  DashboardData,
  "budgetEnvelopes" | "recurringWeeks" | "recurringStatuses"
>;

export type PlanSetupItem = {
  label: string;
  href: string;
};

export function getPlanSetupItems(
  data: PlanData,
  goals: Goal[],
): PlanSetupItem[] {
  const items: PlanSetupItem[] = [];
  if (data.budgetEnvelopes.length === 0) {
    items.push({
      label: "Create a monthly budget",
      href: "/settings#budgets",
    });
  }
  if (goals.length === 0) {
    items.push({ label: "Add a savings goal", href: "/goals" });
  }
  if (
    data.recurringWeeks.length === 0 &&
    data.recurringStatuses.length === 0
  ) {
    items.push({
      label: "Refresh recurring transactions",
      href: "/settings",
    });
  }
  return items;
}

function budgetTone(status: string): "success" | "warning" | "danger" {
  if (status === "over") return "danger";
  if (status === "at-risk") return "warning";
  return "success";
}

function recurringTone(
  status: string,
): "success" | "warning" | "danger" | "accent" {
  if (status === "paid") return "success";
  if (status === "unusual_amount") return "warning";
  if (status === "late") return "danger";
  return "accent";
}

export default function PlanView({
  data,
  goals,
}: {
  data: DashboardData;
  goals: Goal[];
}) {
  const setupItems = getPlanSetupItems(data, goals);
  const recurringItems = data.recurringWeeks.flatMap((week) =>
    week.items.slice(0, 3).map((item) => ({
      ...item,
      weekStart: week.weekStart,
    })),
  );

  return (
    <div className="space-y-5">
      {setupItems.length > 0 && (
        <Panel title="Set up your plan" tone="accent">
          <p className="mb-3 text-sm text-muted">
            Add the missing details below to unlock a more complete monthly plan.
          </p>
          <div className="flex flex-wrap gap-2">
            {setupItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-field border border-accent/25 bg-panel px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-12">
        {data.budgetEnvelopes.length > 0 && (
          <Panel
            title="Budget pace"
            eyebrow="Month-end projection"
            className="xl:col-span-7"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {data.budgetEnvelopes.slice(0, 6).map((budget) => {
                const progress = Math.min(
                  100,
                  (budget.spent / Math.max(1, budget.monthlyLimit)) * 100,
                );
                return (
                  <div
                    key={budget.category}
                    className="rounded-field border border-panel-border bg-panel-2 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">
                        {titleCase(budget.category)}
                      </span>
                      <Badge tone={budgetTone(budget.status)}>{budget.status}</Badge>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-hover">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
                      <span>{formatCurrency(budget.remaining)} left</span>
                      <span>{formatCurrency(budget.projectedSpend)} projected</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link
              href="/settings#budgets"
              className="mt-4 inline-block text-xs font-semibold text-accent hover:underline"
            >
              Manage budgets
            </Link>
          </Panel>
        )}

        {goals.length > 0 && (
          <Panel
            title="Savings goals"
            eyebrow="Funding progress"
            className={data.budgetEnvelopes.length > 0 ? "xl:col-span-5" : "xl:col-span-12"}
          >
            <GoalsSummary goals={goals} />
          </Panel>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Cash forecast"
          eyebrow="Next 30 days"
          tone={data.cashFlowForecast.lowBalanceRisk ? "warning" : "success"}
          className="xl:col-span-5"
        >
          <p className="metric-value text-3xl">
            {formatCurrency(data.cashFlowForecast.projectedBalance)}
          </p>
          <p className="mt-2 text-sm text-muted">
            Lowest projected balance: {formatCurrency(data.cashFlowForecast.lowestBalance)}
          </p>
          <ul className="mt-4 space-y-2 text-xs text-muted">
            {data.cashFlowForecast.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </Panel>

        {recurringItems.length > 0 && (
          <Panel
            title="Recurring calendar"
            eyebrow="Upcoming"
            className="xl:col-span-7"
          >
            <div className="grid gap-x-5 sm:grid-cols-2">
              {recurringItems.slice(0, 6).map((item) => (
                <div
                  key={`${item.weekStart}-${item.name}`}
                  className="flex justify-between gap-4 border-b border-panel-border py-3 first:pt-0"
                >
                  <span>
                    <span className="block text-sm font-semibold">{item.name}</span>
                    <span className="block text-xs text-muted">
                      Week of {item.weekStart}
                    </span>
                  </span>
                  <span
                    className={
                      item.itemType === "income"
                        ? "metric-value text-sm text-success"
                        : "metric-value text-sm"
                    }
                  >
                    {item.itemType === "income" ? "+" : ""}
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {data.recurringStatuses.length > 0 && (
        <Panel title="Recurring status" eyebrow="Paid versus expected">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.recurringStatuses.slice(0, 6).map((item) => (
              <div
                key={item.name}
                className="rounded-field border border-panel-border bg-panel-2 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                  <Badge tone={recurringTone(item.status)}>
                    {item.status.replace("_", " ")}
                  </Badge>
                </div>
                {item.reviewPrompt && (
                  <p className="mt-2 text-xs text-muted">{item.reviewPrompt}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <PlanningDepth data={data} goals={goals} />
    </div>
  );
}
