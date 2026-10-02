import { TRANSFER_GROUPS } from "@/lib/finance-domain";

export interface MerchantDirectoryRow {
  id: string;
  merchant: string;
  total: number;
  count: number;
  lastSeen: string;
  category: string | null;
}

export interface MerchantSourceRow {
  id: string;
  merchant_name: string | null;
  name: string | null;
  amount: number | string;
  date: string;
  pfc_primary: string | null;
}

function transferCategory(value: string | null): string {
  return value?.toUpperCase() ?? "";
}

function rowCategory(row: MerchantSourceRow): string | null {
  if (
    !row.pfc_primary ||
    TRANSFER_GROUPS.has(transferCategory(row.pfc_primary))
  )
    return null;
  return row.pfc_primary;
}

function countsAsOutflow(row: MerchantSourceRow): boolean {
  return (
    Number(row.amount) > 0 &&
    !TRANSFER_GROUPS.has(transferCategory(row.pfc_primary))
  );
}

function updateMerchantRow(
  existing: MerchantDirectoryRow,
  source: MerchantSourceRow,
  amount: number,
  category: string | null,
): void {
  if (countsAsOutflow(source)) existing.total += amount;
  existing.count += 1;
  if (source.date > existing.lastSeen) existing.lastSeen = source.date;
  if (!existing.category && category) existing.category = category;
}

function createMerchantRow(
  merchant: string,
  source: MerchantSourceRow,
  amount: number,
  category: string | null,
): MerchantDirectoryRow {
  return {
    id: merchant,
    merchant,
    total: countsAsOutflow(source) ? amount : 0,
    count: 1,
    lastSeen: source.date,
    category,
  };
}

export function buildMerchantDirectory(
  rows: readonly MerchantSourceRow[],
): MerchantDirectoryRow[] {
  const grouped = new Map<string, MerchantDirectoryRow>();
  for (const row of rows) {
    const merchant =
      (row.merchant_name ?? row.name ?? "Unknown").trim() || "Unknown";
    const existing = grouped.get(merchant);
    const amount = Number(row.amount);
    const category = rowCategory(row);
    if (existing) {
      updateMerchantRow(existing, row, amount, category);
    } else {
      grouped.set(merchant, createMerchantRow(merchant, row, amount, category));
    }
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.total - left.total || left.merchant.localeCompare(right.merchant),
  );
}
