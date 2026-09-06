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
    <>
      {/* Mobile cards: every column of the desktop table stays reachable
          without a 640px scroll region. */}
      <div className="space-y-2 sm:hidden">
        {page.byClass.map((group) => (
          <Fragment key={group.label}>
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted first:pt-0">
              {group.label} · <span data-money>{formatCurrency(group.subtotal, currency)}</span>
            </p>
            {group.holdings.map((h) => (
              <div key={h.id} className="rounded-field border border-panel-border bg-panel-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <InstitutionAvatar name={h.securityName} size={28} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{h.securityName}</div>
                      {h.ticker && <div className="text-xs text-muted">{h.ticker}</div>}
                    </div>
                  </div>
                  <span data-money className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCurrency(h.value, currency)}
                  </span>
                </div>
                {/* Wraps rather than truncates: the mask at the end of the
                    account name is the only thing telling two accounts at the
                    same brokerage apart, and an ellipsis eats exactly that. */}
                <div className="mt-2 break-words text-xs text-muted">{h.accountName}</div>
                {/* Every figure the desktop table gives a column head, labelled
                    here instead — below the breakpoint there is no header row
                    and no horizontal scroll to reach price and quantity. */}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    Price{" "}
                    <span data-money className="tabular-nums">
                      {h.price != null ? formatCurrency(h.price, currency) : "—"}
                    </span>
                  </span>
                  <span>
                    Quantity <span className="tabular-nums">{h.quantity ?? "—"}</span>
                  </span>
                  <span>
                    Weight <span className="tabular-nums">{h.weightPct.toFixed(1)}%</span>
                  </span>
                  <span>
                    Change{" "}
                    <span
                      data-money
                      className={cn("tabular-nums", changeClassName(h.periodChangePct))}
                      style={{ color: changeColor(h.periodChangePct) ?? undefined }}
                    >
                      {changeLabel(h.periodChangePct)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </Fragment>
        ))}
        <div className="flex items-center justify-between rounded-field bg-panel-2 p-3 text-sm font-semibold">
          <span>Total</span>
          <span data-money className="tabular-nums">{formatCurrency(page.total, currency)}</span>
        </div>
      </div>
      <div className="hidden overflow-x-auto sm:block">
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
                    colSpan={7}
                    className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    {group.label} · <span data-money>{formatCurrency(group.subtotal, currency)}</span>
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
    </>
  );
}
