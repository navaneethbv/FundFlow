import Link from "next/link";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Panel from "@/components/ui/Panel";
import { buttonVariants } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import type {
  DebtPlannerData,
  DebtStrategy,
} from "@/lib/debt-data";

function plannerHref(
  strategy: DebtStrategy,
  extraMonthly: number,
  scopeParam?: string,
): string {
  const params = new URLSearchParams({ strategy });
  if (extraMonthly > 0) params.set("extra", String(extraMonthly));
  if (scopeParam) params.set("scope", scopeParam);
  return `/debt?${params.toString()}`;
}

export default function DebtPlannerView({
  data,
  strategy,
  extraMonthly,
  scopeParam,
}: Readonly<{
  data: DebtPlannerData;
  strategy: DebtStrategy;
  extraMonthly: number;
  scopeParam?: string;
}>) {
  if (data.debts.length === 0) {
    return (
      <Panel title="No debt accounts found" eyebrow="Debt payoff projection">
        <p className="text-sm text-muted">
          Connect or add a liability account to compare avalanche and snowball
          payoff projections.
        </p>
        <Link
          href="/settings?section=institutions"
          className={buttonVariants({ variant: "secondary", className: "mt-4" })}
        >
          Manage accounts
        </Link>
      </Panel>
    );
  }

  const selectedPlan = data[strategy];
  const comparison = data[strategy === "avalanche" ? "snowball" : "avalanche"];
  const debtById = new Map(data.debts.map((debt) => [debt.id, debt]));
  const resultById = new Map(
    (selectedPlan?.debts ?? []).map((result) => [result.name, result]),
  );

  return (
    <div className="space-y-6">
      <Panel
        eyebrow="Debt payoff projection"
        title="Compare payoff strategies"
        action={
          <SegmentedControl
            ariaLabel="Debt payoff strategy"
            items={[
              {
                label: "Avalanche",
                href: plannerHref("avalanche", extraMonthly, scopeParam),
                active: strategy === "avalanche",
              },
              {
                label: "Snowball",
                href: plannerHref("snowball", extraMonthly, scopeParam),
                active: strategy === "snowball",
              },
            ]}
          />
        }
      >
        <p className="mb-5 max-w-3xl text-sm text-muted">
          This projection assumes steady monthly payments and unchanged APRs.
          It is not a guarantee.
        </p>

        <form
          method="get"
          action="/debt"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="strategy" value={strategy} />
          {scopeParam && <input type="hidden" name="scope" value={scopeParam} />}
          <label className="grid gap-1.5 text-sm font-semibold">
            <span>Extra monthly payment</span>
            <input
              name="extra"
              type="number"
              min="0"
              step="0.01"
              defaultValue={extraMonthly || ""}
              placeholder="0.00"
              className="min-h-11 w-44 rounded-field border border-panel-border bg-panel-2 px-3 text-foreground focus-visible:outline-2"
            />
          </label>
          <button type="submit" className={buttonVariants()}>
            Update projection
          </button>
        </form>
      </Panel>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Total balance
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.totalBalance)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Monthly budget
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.totalMonthlyBudget)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Debt-free projection
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {selectedPlan ? `${selectedPlan.months} months` : "Not reached"}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Total projected interest
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {selectedPlan ? formatCurrency(selectedPlan.totalInterest) : "Not reached"}
          </dd>
        </Panel>
      </dl>

      {!selectedPlan ? (
        <Panel tone="warning" title="The current monthly budget is insufficient">
          <p className="text-sm text-muted">
            The payment does not cover the projected interest over the payoff
            horizon. Increase the extra monthly payment or update an assumed APR.
          </p>
        </Panel>
      ) : (
        <Panel
          eyebrow={strategy === "avalanche" ? "Highest APR first" : "Smallest balance first"}
          title={`${strategy === "avalanche" ? "Avalanche" : "Snowball"} payoff order`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-panel-border text-xs uppercase tracking-wide text-muted font-mono">
                <tr>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3">Debt</th>
                  <th className="px-3 py-3 text-right">Balance</th>
                  <th className="px-3 py-3 text-right">APR</th>
                  <th className="px-3 py-3 text-right">Payoff projection</th>
                  <th className="px-3 py-3 text-right">Projected interest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-border">
                {selectedPlan.order.map((accountId, index) => {
                  // The plan identifies debts by account id, not display name —
                  // two accounts can share a name. See `lib/debt-data.ts`.
                  const debt = debtById.get(accountId);
                  const result = resultById.get(accountId);
                  if (!debt || !result) return null;
                  return (
                    <tr key={accountId}>
                      <td className="px-3 py-3 font-semibold">{index + 1}</td>
                      <td className="px-3 py-3">
                        <span className="font-semibold">{debt.name}</span>
                        {debt.aprAssumed && (
                          <span className="ml-2 rounded-full bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">
                            22% assumed APR
                          </span>
                        )}
                      </td>
                      <td data-money className="px-3 py-3 text-right" style={{ color: "var(--viz-neg)" }}>
                        {formatCurrency(debt.balance)}
                      </td>
                      <td className="money px-3 py-3 text-right">{debt.apr.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-right">Month {result.payoffMonth}</td>
                      <td data-money className="px-3 py-3 text-right" style={{ color: "var(--viz-neg)" }}>
                        {formatCurrency(result.interestPaid)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Strategy comparison" eyebrow="Same monthly budget">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-semibold capitalize">{strategy}</p>
            <p className="mt-1 text-muted">
              {selectedPlan
                ? `${selectedPlan.months} months and ${formatCurrency(selectedPlan.totalInterest)} projected interest.`
                : "The projection does not converge."}
            </p>
          </div>
          <div>
            <p className="font-semibold capitalize">
              {strategy === "avalanche" ? "snowball" : "avalanche"}
            </p>
            <p className="mt-1 text-muted">
              {comparison
                ? `${comparison.months} months and ${formatCurrency(comparison.totalInterest)} projected interest.`
                : "The projection does not converge."}
            </p>
          </div>
        </div>
      </Panel>

      {data.debts.some((debt) => debt.aprAssumed) && (
        <Panel tone="warning" title="Replace assumed APRs for a more useful projection">
          <p className="text-sm text-muted">
            FundFlow uses 22% only where an account has no APR.
          </p>
          <Link
            href="/settings?section=institutions#card-aprs"
            className={buttonVariants({ variant: "secondary", className: "mt-4" })}
          >
            Update card APRs
          </Link>
        </Panel>
      )}
    </div>
  );
}
