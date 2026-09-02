import type { ExportRow } from "@/lib/export";
import {
  TAX_CATEGORIES,
  TAX_FALLBACK_LINE_ITEM,
  resolveTaxLineItem,
} from "@/lib/tax-categories";

/**
 * Pure builder behind the yearly tax export (`/api/export/tax`): filters the
 * canonical projection down to tax-relevant transactions, labels each row with
 * its tax line item, and totals one summary line per line item.
 *
 * Split-safe by construction: a split parent arrives as one projected row per
 * part sharing `sourceTransactionId`, each part carries its own signed amount,
 * and the parts sum to the transaction amount — so every total counts the
 * transaction exactly once. The tax line item is looked up on the parent's
 * tags and inherited by all of its parts.
 */

export interface TaxExportTransaction {
  sourceTransactionId: string;
  date: string;
  merchant: string;
  signedAmount: number;
}

export interface TaxExportSummaryLine {
  lineItem: string;
  count: number;
  total: number;
}

export interface TaxExport {
  /** Detail rows in date order; `category` holds the tax line item. */
  rows: ExportRow[];
  /** One line per used line item, in curated declaration order. */
  summary: TaxExportSummaryLine[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildTaxExport(
  transactions: readonly TaxExportTransaction[],
  tagsByTransactionId: ReadonlyMap<string, readonly string[]>,
): TaxExport {
  const totals = new Map<string, { count: number; total: number }>();
  const rows: ExportRow[] = [];

  for (const txn of transactions) {
    const tags = tagsByTransactionId.get(txn.sourceTransactionId) ?? [];
    const lineItem = resolveTaxLineItem(tags);
    if (!lineItem) continue;
    rows.push({
      date: txn.date,
      merchant: txn.merchant || "Unknown",
      amount: txn.signedAmount,
      category: lineItem,
    });
    const bucket = totals.get(lineItem) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += txn.signedAmount;
    totals.set(lineItem, bucket);
  }

  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant),
  );

  const declarationOrder = new Map(
    [...TAX_CATEGORIES.map((category) => category.lineItem), TAX_FALLBACK_LINE_ITEM].map(
      (lineItem, index) => [lineItem, index],
    ),
  );
  const summary = [...totals.entries()]
    .map(([lineItem, { count, total }]) => ({
      lineItem,
      count,
      total: round2(total),
    }))
    .sort(
      (a, b) =>
        (declarationOrder.get(a.lineItem) ?? declarationOrder.size) -
          (declarationOrder.get(b.lineItem) ?? declarationOrder.size) ||
        a.lineItem.localeCompare(b.lineItem),
    );

  return { rows, summary };
}
