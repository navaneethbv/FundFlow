export const INSIGHT_TYPES = [
  "new_merchant",
  "double_charge",
  "category_spike",
  "merchant_spike",
  "bill_overdue",
  "savings_rate_change",
  "idle_cash",
  "goal_reserve_depleted",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];
