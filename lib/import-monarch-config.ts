/**
 * Monarch Budget and Goal configuration parser.
 * Supports importing budget categories, monthly limits, rollover flags,
 * and funded goal configurations from Monarch exports.
 */

export interface MonarchBudgetImportRow {
  category: string;
  group: string | null;
  monthlyLimit: number;
  rolloverEnabled: boolean;
}

export interface MonarchGoalImportRow {
  name: string;
  type: "save_up" | "pay_down";
  targetAmount: number;
  targetDate: string | null;
  monthlyContribution: number | null;
  linkedAccountName?: string | null;
}

export function parseMonarchBudgetCsv(csvText: string): MonarchBudgetImportRow[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const header = lines[0]!.toLowerCase().split(",").map((col) => col.replace(/["']/g, "").trim());
  const catIdx = header.findIndex((h) => h === "category");
  const groupIdx = header.findIndex((h) => h === "group" || h === "category group");
  const amountIdx = header.findIndex((h) => h === "amount" || h === "budgeted" || h === "monthly budget");
  const rolloverIdx = header.findIndex((h) => h.includes("rollover"));

  if (catIdx === -1) return [];

  const results: MonarchBudgetImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i]!.split(",").map((col) => col.replace(/^["']|["']$/g, "").trim());
    const category = rawCols[catIdx]?.trim();
    if (!category) continue;

    const group = groupIdx !== -1 ? rawCols[groupIdx]?.trim() || null : null;
    const rawAmount = amountIdx !== -1 ? parseFloat(rawCols[amountIdx] ?? "0") : 0;
    const monthlyLimit = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
    const rolloverVal = rolloverIdx !== -1 ? rawCols[rolloverIdx]?.toLowerCase() : "";
    const rolloverEnabled = rolloverVal === "true" || rolloverVal === "yes" || rolloverVal === "1";

    results.push({
      category,
      group,
      monthlyLimit,
      rolloverEnabled,
    });
  }

  return results;
}

export function parseMonarchGoalCsv(csvText: string): MonarchGoalImportRow[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const header = lines[0]!.toLowerCase().split(",").map((col) => col.replace(/["']/g, "").trim());
  const nameIdx = header.findIndex((h) => h === "name" || h === "goal name" || h === "goal");
  const targetAmountIdx = header.findIndex((h) => h.includes("target amount") || h === "target");
  const targetDateIdx = header.findIndex((h) => h.includes("target date") || h === "date");
  const monthlyIdx = header.findIndex((h) => h.includes("monthly") || h.includes("contribution"));
  const typeIdx = header.findIndex((h) => h === "type" || h === "goal type");
  const accountIdx = header.findIndex((h) => h.includes("account"));

  if (nameIdx === -1) return [];

  const results: MonarchGoalImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i]!.split(",").map((col) => col.replace(/^["']|["']$/g, "").trim());
    const name = rawCols[nameIdx]?.trim();
    if (!name) continue;

    const rawTarget = targetAmountIdx !== -1 ? parseFloat(rawCols[targetAmountIdx] ?? "0") : 0;
    const targetAmount = Number.isFinite(rawTarget) ? Math.abs(rawTarget) : 0;

    const targetDate = targetDateIdx !== -1 ? rawCols[targetDateIdx]?.trim() || null : null;
    const rawMonthly = monthlyIdx !== -1 ? parseFloat(rawCols[monthlyIdx] ?? "0") : null;
    const monthlyContribution = rawMonthly !== null && Number.isFinite(rawMonthly) ? Math.abs(rawMonthly) : null;

    const rawType = typeIdx !== -1 ? rawCols[typeIdx]?.toLowerCase() : "";
    const type: "save_up" | "pay_down" = rawType.includes("pay") || rawType.includes("debt") ? "pay_down" : "save_up";

    const linkedAccountName = accountIdx !== -1 ? rawCols[accountIdx]?.trim() || null : null;

    results.push({
      name,
      type,
      targetAmount,
      targetDate,
      monthlyContribution,
      linkedAccountName,
    });
  }

  return results;
}
