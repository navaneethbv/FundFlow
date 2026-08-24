import { Fragment } from "react";
import { InstitutionAvatar } from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import type { InvestmentsPage } from "@/lib/investments";

/** Every active holding grouped by asset class — the plan's fixed slot order. */
function changeClassName(periodChangePct: number | null): string {
  return periodChangePct == null ? "text-muted" : "";
}

function changeColor(periodChangePct: number | null): string | undefined {
  if (periodChangePct == null) return undefined;
  return periodChangePct >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
}

function changeLabel(periodChangePct: number | null): string {
  if (periodChangePct == null) return "—";
  const sign = periodChangePct >= 0 ? "+" : "";
  return `${sign}${periodChangePct.toFixed(1)}%`;
}

export default function HoldingsTable({
  page,
  currency,
}: Readonly<{ page: InvestmentsPage; currency: string }>) {
  if (page.byClass.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        description="Connect a brokerage account, or add a manual holding for anything Plaid can't see."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-semibold">Security</th>
            <th className="py-2 pr-3 font-semibold">Account</th>
            <th className="py-2 pr-3 text-right font-semibold">Price</th>
            <th className="py-2 pr-3 text-right font-semibold">Quantity</th>
            <th className="py-2 pr-3 text-right font-semibold">Value</th>
            <th className="py-2 pr-3 text-right font-semibold">Weight</th>
            <th className="py-2 pr-0 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {page.byClass.map((group) => (
            <Fragment key={group.label}>
              <tr className="border-b border-panel-border/60 bg-panel-2">
                <td
                  data-money
                  colSpan={7}
                  className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  {group.label} · {formatCurrency(group.subtotal, currency)}
                </td>
              </tr>
              {group.holdings.map((h) => (
                <tr key={h.id} className="border-b border-panel-border/40">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2.5">
                      <InstitutionAvatar name={h.securityName} size={28} className="shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{h.securityName}</div>
                        {h.ticker && <div className="text-xs text-muted">{h.ticker}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-muted">{h.accountName}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {h.price != null ? formatCurrency(h.price, currency) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{h.quantity ?? "—"}</td>
                  <td data-money className="py-2 pr-3 text-right tabular-nums font-medium">
                    {formatCurrency(h.value, currency)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted">{h.weightPct.toFixed(1)}%</td>
                  <td
                    data-money
                    className={cn(
                      "py-2 pr-0 text-right tabular-nums",
                      changeClassName(h.periodChangePct),
                    )}
                    style={{ color: changeColor(h.periodChangePct) }}
                  >
                    {changeLabel(h.periodChangePct)}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-panel-border bg-panel-2 font-semibold">
            <td className="py-2 pr-3" colSpan={4}>
              Total
            </td>
            <td data-money className="py-2 pr-3 text-right tabular-nums">
              {formatCurrency(page.total, currency)}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums text-muted">100%</td>
            <td className="py-2 pr-0" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
