import { CanonicalFinanceTransaction } from "./finance-domain";

export const WIDGET_KEYS = [
  "budget",
  "spendingCompare",
  "netWorth",
  "transactions",
  "recurring",
  "goals",
  "investments",
] as const;

export type WidgetKey = (typeof WIDGET_KEYS)[number];

export interface DashboardWidgetPrefs {
  order: WidgetKey[];
  hidden: WidgetKey[];
}

export function normalizeWidgetPrefs(raw: unknown): DashboardWidgetPrefs {
  const defaultOrder: WidgetKey[] = [
    "spendingCompare",
    "budget",
    "netWorth",
    "transactions",
    "recurring",
    "goals",
    "investments",
  ];

  if (!raw || typeof raw !== "object") {
    return { order: defaultOrder, hidden: [] };
  }

  const rawObj = raw as Record<string, unknown>;
  const rawOrder = Array.isArray(rawObj.order) ? rawObj.order : [];
  const rawHidden = Array.isArray(rawObj.hidden) ? rawObj.hidden : [];

  const order: WidgetKey[] = rawOrder.filter((k: unknown): k is WidgetKey =>
    typeof k === "string" && (WIDGET_KEYS as readonly string[]).includes(k),
  );

  const hidden: WidgetKey[] = rawHidden.filter((k: unknown): k is WidgetKey =>
    typeof k === "string" && (WIDGET_KEYS as readonly string[]).includes(k),
  );

  // Ensure missing keys exist in order
  for (const k of WIDGET_KEYS) {
    if (!order.includes(k)) order.push(k);
  }

  return { order, hidden };
}

export function computeCumulativeSpendByDay(
  txns: CanonicalFinanceTransaction[],
  month: string,
  todayDay: number = 31,
): { day: number; thisMonth: number | null; lastMonth: number | null }[] {
  const [y, m] = month.split("-").map(Number);
  const lastMonthKey = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;

  const thisMonthDaily = new Map<number, number>();
  const lastMonthDaily = new Map<number, number>();

  for (const t of txns) {
    if (t.flow !== "expense") continue;
    const tMonth = t.date.slice(0, 7);
    const dayNum = Number(t.date.slice(8, 10));
    const amt = Math.abs(t.signedAmount);

    if (tMonth === month) {
      thisMonthDaily.set(dayNum, (thisMonthDaily.get(dayNum) || 0) + amt);
    } else if (tMonth === lastMonthKey) {
      lastMonthDaily.set(dayNum, (lastMonthDaily.get(dayNum) || 0) + amt);
    }
  }

  const result: { day: number; thisMonth: number | null; lastMonth: number | null }[] = [];
  let cumThis = 0;
  let cumLast = 0;

  for (let d = 1; d <= 31; d++) {
    cumLast += lastMonthDaily.get(d) || 0;

    if (d <= todayDay) {
      cumThis += thisMonthDaily.get(d) || 0;
      result.push({
        day: d,
        thisMonth: Math.round(cumThis * 100) / 100,
        lastMonth: Math.round(cumLast * 100) / 100,
      });
    } else {
      result.push({
        day: d,
        thisMonth: null,
        lastMonth: Math.round(cumLast * 100) / 100,
      });
    }
  }

  return result;
}
