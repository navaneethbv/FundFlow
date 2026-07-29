"use client";

import { formatCurrency } from "@/lib/format";
import type { HoldingRow } from "@/lib/investments";

export default function HoldingsTable({
  holdings,
}: Readonly<{
  holdings: HoldingRow[];
}>) {
  return (
    <div className="rounded-panel border border-panel-border bg-panel overflow-hidden">
      <div className="border-b border-panel-border px-5 py-4">
        <h3 className="font-semibold text-foreground">Holdings</h3>
      </div>

      <div className="divide-y divide-panel-border overflow-x-auto">
        {holdings.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No investment holdings found.
          </div>
        ) : (
          holdings.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between px-5 py-3.5 text-sm hover:bg-panel-hover"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{h.securityName}</span>
                  {h.ticker && (
                    <span className="rounded bg-panel-border px-1.5 py-0.5 text-[0.65rem] font-bold text-muted">
                      {h.ticker}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {h.accountName} · {h.quantity ?? 0} shares @ {formatCurrency(h.price ?? 0)}
                </p>
              </div>

              <div className="text-right">
                <p className="font-semibold text-foreground">{formatCurrency(h.value ?? 0)}</p>
                <p className="text-xs text-muted">{h.weightPct}% of portfolio</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
