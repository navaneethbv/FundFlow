import type { DashboardData } from "@/lib/dashboard";
import { formatCurrency, titleCase } from "@/lib/format";
import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import TrendChart from "@/components/charts/TrendChart";

function statusTone(status: string): "success" | "warning" | "danger" {
  if (status === "over") return "danger";
  if (status === "at-risk") return "warning";
  return "success";
}

function recurringTone(status: string): "success" | "warning" | "danger" | "accent" {
  if (status === "paid") return "success";
  if (status === "unusual_amount") return "warning";
  if (status === "late") return "danger";
  return "accent";
}

export default function PlanningInsights({ data }: { data: DashboardData }) {
  const topBudgets = data.budgetEnvelopes.slice(0, 4);
  const anomalies = data.spendingAnomalies.slice(0, 3);
  const recurringItems = data.recurringWeeks.flatMap((week) =>
    week.items.slice(0, 3).map((item) => ({ ...item, weekStart: week.weekStart })),
  );
  const recurringStatuses = data.recurringStatuses.slice(0, 6);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel title="Budget envelopes" eyebrow="Month-end pace">
        <div className="space-y-3">
          {topBudgets.map((budget) => (
            <div key={budget.category} className="space-y-2 rounded-field bg-panel-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{titleCase(budget.category)}</span>
                <Badge tone={statusTone(budget.status)}>{budget.status}</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-hover">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.min(100, (budget.spent / Math.max(1, budget.monthlyLimit)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted">
                {formatCurrency(budget.remaining)} left, projected {formatCurrency(budget.projectedSpend)}
              </p>
            </div>
          ))}
          {topBudgets.length === 0 && (
            <p className="py-4 text-sm text-muted">Add budgets in Settings to see envelope pacing.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Cash forecast"
        eyebrow="Next 30 days"
        tone={data.cashFlowForecast.lowBalanceRisk ? "warning" : "success"}
      >
        <p className="display text-3xl">
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

      <Panel title="Review prompts" eyebrow="Deterministic alerts">
        <div className="space-y-3 text-sm">
          {anomalies.map((anomaly) => (
            <div key={`${anomaly.kind}-${anomaly.transactionId ?? anomaly.category}`} className="rounded-field bg-panel-2 p-3">
              <Badge tone={anomaly.severity === "warning" ? "warning" : "accent"}>
                {titleCase(anomaly.kind)}
              </Badge>
              <p className="mt-2 text-muted">{anomaly.message}</p>
            </div>
          ))}
          {anomalies.length === 0 && (
            <p className="py-4 text-sm text-muted">No unusual spending patterns detected for this month.</p>
          )}
        </div>
      </Panel>

      <Panel title="Recurring calendar" eyebrow="Upcoming">
        <div className="space-y-2 text-sm">
          {recurringItems.slice(0, 5).map((item) => (
            <div key={`${item.weekStart}-${item.name}`} className="flex justify-between gap-4 rounded-field p-2 hover:bg-panel-hover">
              <span>
                <span className="block font-semibold">{item.name}</span>
                <span className="block text-xs text-muted">Week of {item.weekStart}</span>
              </span>
              <span className={item.itemType === "income" ? "font-bold text-success" : "font-bold"}>
                {item.itemType === "income" ? "+" : ""}
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
          {recurringItems.length === 0 && (
            <p className="py-4 text-sm text-muted">No recurring items found yet.</p>
          )}
        </div>
      </Panel>

      <Panel title="Recurring status" eyebrow="Paid vs expected">
        <div className="space-y-2 text-sm">
          {recurringStatuses.map((item) => (
            <div key={item.name} className="rounded-field bg-panel-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.name}</span>
                <Badge tone={recurringTone(item.status)}>{item.status.replace("_", " ")}</Badge>
              </div>
              {item.reviewPrompt && <p className="mt-2 text-xs text-muted">{item.reviewPrompt}</p>}
            </div>
          ))}
          {recurringStatuses.length === 0 && (
            <p className="py-4 text-sm text-muted">No recurring streams to track yet.</p>
          )}
        </div>
      </Panel>

      <Panel title="Net worth snapshot" eyebrow="Assets and liabilities" className="xl:col-span-2">
        <div className="grid gap-6 md:grid-cols-2">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Assets</dt>
              <dd className="font-bold">{formatCurrency(data.netWorthSnapshot.assets)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Liabilities</dt>
              <dd className="font-bold">{formatCurrency(data.netWorthSnapshot.liabilities)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-panel-border pt-3">
              <dt className="font-semibold">Net worth</dt>
              <dd className="display text-xl">{formatCurrency(data.netWorthSnapshot.netWorth)}</dd>
            </div>
          </dl>
          {data.netWorthHistory && data.netWorthHistory.length > 0 && (
            <div className="border-t border-panel-border pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
              <h4 className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">Trend</h4>
              <TrendChart
                labels={data.netWorthHistory.map((h) => h.month)}
                series={[
                  {
                    name: "Net Worth",
                    slot: 2,
                    values: data.netWorthHistory.map((h) => h.netWorth),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
