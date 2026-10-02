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

export function buildMerchantDirectory(rows: readonly MerchantSourceRow[]): MerchantDirectoryRow[] {
  const grouped = new Map<string, MerchantDirectoryRow>();
  for (const row of rows) {
    const merchant = (row.merchant_name ?? row.name ?? "Unknown").trim() || "Unknown";
    const existing = grouped.get(merchant);
    const amount = Number(row.amount);
    const category = row.pfc_primary && !TRANSFER_GROUPS.has(row.pfc_primary.toUpperCase()) ? row.pfc_primary : null;
    const countsAsOutflow = amount > 0 && !TRANSFER_GROUPS.has((row.pfc_primary ?? "").toUpperCase());
    if (existing) {
      existing.total += countsAsOutflow ? amount : 0;
      existing.count += 1;
      if (row.date > existing.lastSeen) existing.lastSeen = row.date;
      if (!existing.category && category) existing.category = category;
    } else {
      grouped.set(merchant, { id: merchant, merchant, total: countsAsOutflow ? amount : 0, count: 1, lastSeen: row.date, category });
    }
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total || left.merchant.localeCompare(right.merchant));
}
