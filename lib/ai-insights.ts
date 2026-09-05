export interface AiInsightRow {
  month?: string;
  merchant?: string;
  /** Nullable, not just optional: it comes from the nullable `pfc_primary`
   *  column, and the `?? "UNCATEGORIZED"` fallback below already handles a
   *  null. Typing it `string | undefined` made a real row shape unassignable. */
  category?: string | null;
  amount?: number;
}

export function generateAiInsightSummaries(input: {
  enabled: boolean;
  rows: AiInsightRow[];
}) {
  if (!input.enabled) return [];

  const rows = input.rows.filter(
    (row): row is AiInsightRow & { amount: number } =>
      typeof row.amount === "number" && !Number.isNaN(row.amount),
  );
  const months = [...new Set(rows.map((row) => row.month).filter(Boolean) as string[])];
  months.sort((a, b) => a.localeCompare(b));
  const month = months.at(-1) ?? null;
  const spending = rows
    .filter((row) => row.amount > 0)
    .reduce((sum, row) => sum + row.amount, 0);
  const income = rows
    .filter((row) => row.amount < 0)
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const topCategory = rows
    .filter((row) => row.amount > 0)
    .reduce((map, row) => {
      const category = row.category ?? "UNCATEGORIZED";
      map.set(category, (map.get(category) ?? 0) + row.amount);
      return map;
    }, new Map<string, number>());
  const top = [...topCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "spending";

  const periodSummary =
    months.length > 1
      ? `Across ${months.length} months, you tracked ${Math.round(spending)} in spending against ${Math.round(income)} in income.`
      : `This month shows ${Math.round(spending)} in tracked spending against ${Math.round(income)} in income.`;

  return [
    {
      insightType: "what_changed",
      sourceMonth: month,
      summary: periodSummary,
    },
    {
      insightType: "save_100",
      sourceMonth: month,
      summary: `Start with ${top}; trimming a few repeat purchases is the clearest path to save 100.`,
    },
    {
      insightType: "subscriptions_to_review",
      sourceMonth: month,
      summary: "Review recurring merchants with rising amounts or duplicate monthly charges.",
    },
    {
      insightType: "goal_pace_check",
      sourceMonth: month,
      summary: "Compare monthly surplus with active goal pace before increasing contributions.",
    },
  ];
}
