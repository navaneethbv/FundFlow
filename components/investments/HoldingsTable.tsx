import { Fragment } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { formatCurrency } from "@/lib/format";
import type { InvestmentsPage } from "@/lib/investments";

/** Every active holding grouped by asset class — the plan's fixed slot order. */
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
            <th className="py-2 pr-3 text-right font-semibold">Quantity</th>
            <th className="py-2 pr-3 text-right font-semibold">Price</th>
            <th className="py-2 pr-3 text-right font-semibold">Value</th>
            <th className="py-2 pr-3 text-right font-semibold">Weight</th>
            <th className="py-2 pr-0 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {page.byClass.map((group) => (
            <Fragment key={group.label}>
              <tr className="border-b border-panel-border/60 bg-panel/60">
                <td colSpan={7} className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.label} · {formatCurrency(group.subtotal, currency)}
                </td>
              </tr>
              {group.holdings.map((h) => (
                <tr key={h.id} className="border-b border-panel-border/40">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{h.securityName}</div>
                    {h.ticker && <div className="text-xs text-muted">{h.ticker}</div>}
                  </td>
                  <td className="py-2 pr-3 text-muted">{h.accountName}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{h.quantity ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {h.price != null ? formatCurrency(h.price, currency) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">
                    {formatCurrency(h.value, currency)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted">{h.weightPct.toFixed(1)}%</td>
                  <td
                    className="py-2 pr-0 text-right tabular-nums"
                    style={{
                      color:
                        h.periodChangePct == null
                          ? undefined
                          : h.periodChangePct >= 0
                            ? "var(--viz-good)"
                            : "var(--viz-bad)",
                    }}
                  >
                    {h.periodChangePct == null
                      ? "—"
                      : `${h.periodChangePct >= 0 ? "+" : ""}${h.periodChangePct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
