export interface AiInsightRow {
  month?: string;
  merchant?: string;
  category?: string;
  amount?: number;
}

export function generateAiInsightSummaries(input: {
  enabled: boolean;
  rows: AiInsightRow[];
}) {
  if (!input.enabled) return [];

  const rows = input.rows.filter((row) => typeof row.amount === "number");
  const month = rows.find((row) => row.month)?.month ?? null;
  const spending = rows
    .filter((row) => (row.amount ?? 0) > 0)
    .reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const income = rows
    .filter((row) => (row.amount ?? 0) < 0)
    .reduce((sum, row) => sum + Math.abs(row.amount ?? 0), 0);
  const topCategory = rows
    .filter((row) => (row.amount ?? 0) > 0)
    .reduce((map, row) => {
      const category = row.category ?? "UNCATEGORIZED";
      map.set(category, (map.get(category) ?? 0) + (row.amount ?? 0));
      return map;
    }, new Map<string, number>());
  const top = [...topCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "spending";

  return [
    {
      insightType: "what_changed",
      sourceMonth: month,
      summary: `This month shows ${Math.round(spending)} in tracked spending against ${Math.round(income)} in income.`,
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
