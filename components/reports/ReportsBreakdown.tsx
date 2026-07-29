"use client";

import { formatCurrency, titleCase } from "@/lib/format";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

export default function ReportsBreakdown({
  transactions,
  type = "spending",
}: Readonly<{
  transactions: CanonicalFinanceTransaction[];
  type?: "cashflow" | "spending" | "income";
}>) {
  const categoryMap = new Map<string, number>();

  for (const t of transactions) {
    if (type === "spending" && t.flow !== "expense") continue;
    if (type === "income" && t.flow !== "income") continue;

    const cat = t.categoryKey || "Uncategorized";
    const amt = Math.abs(t.signedAmount);
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + amt);
  }

  const rows = Array.from(categoryMap.entries())
    .map(([cat, amount]) => ({ cat, amount }))
    .sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((acc, r) => acc + r.amount, 0) || 1;

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-6 space-y-4">
      <h3 className="font-semibold text-foreground">
        {type === "income" ? "Income Categories" : "Spending Categories"}
      </h3>

      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No transactions found for this view.</p>
        ) : (
          rows.map(({ cat, amount }) => {
            const pct = Math.round((amount / total) * 100);
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{titleCase(cat)}</span>
                  <span className="text-muted">
                    {formatCurrency(amount)} ({pct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-panel-border overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
