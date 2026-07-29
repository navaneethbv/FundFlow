export interface HoldingJoinRow {
  id: string;
  accountId: string | null;
  manualAccountId: string | null;
  accountName: string;
  securityName: string;
  ticker: string | null;
  securityType: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  source: "plaid" | "manual";
  isActive: boolean;
}

export interface HoldingSnapshotRow {
  holdingId: string;
  snapshotDate: string;
  quantity: number | null;
  price: number | null;
  value: number | null;
}

export interface HoldingRow extends HoldingJoinRow {
  weightPct: number;
  periodChangePct: number | null;
}

export interface InvestmentsPage {
  total: number;
  dayChange: { amount: number; pct: number } | null;
  byClass: { label: string; holdings: HoldingRow[]; subtotal: number }[];
  topMovers: { name: string; ticker: string | null; changePct: number }[] | null;
  balanceHistory: { date: string; value: number }[];
}

export function buildInvestmentsPage(
  holdings: HoldingJoinRow[],
): InvestmentsPage {
  const activeHoldings = holdings.filter((h) => h.isActive);
  const totalVal = activeHoldings.reduce((acc, h) => acc + (h.value || 0), 0);
  const total = Math.round(totalVal * 100) / 100;

  const classMap = new Map<string, HoldingRow[]>();

  for (const h of activeHoldings) {
    const assetClass = h.securityType ? h.securityType.toUpperCase() : "UNCLASSIFIED";
    const weightPct = total > 0 ? Math.round(((h.value || 0) / total) * 10000) / 100 : 0;

    const row: HoldingRow = {
      ...h,
      weightPct,
      periodChangePct: null,
    };

    const arr = classMap.get(assetClass) || [];
    arr.push(row);
    classMap.set(assetClass, arr);
  }

  const byClass = Array.from(classMap.entries()).map(([label, rows]) => {
    const subtotal = rows.reduce((acc, r) => acc + (r.value || 0), 0);
    return {
      label,
      holdings: rows.sort((a, b) => (b.value || 0) - (a.value || 0)),
      subtotal: Math.round(subtotal * 100) / 100,
    };
  });

  return {
    total,
    dayChange: null,
    byClass: byClass.sort((a, b) => b.subtotal - a.subtotal),
    topMovers: null,
    balanceHistory: [],
  };
}
