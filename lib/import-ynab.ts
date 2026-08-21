/**
 * YNAB register-export CSV import. YNAB's export header is
 * `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"`.
 *
 * Like a plain bank CSV's debit/credit pair, YNAB splits direction into an
 * `Outflow`/`Inflow` column pair — a nonzero Outflow is money out, a nonzero
 * Inflow is money in. We reuse the exact shared `twoColumnToSignedAmount` rule
 * the generic parser uses, so the sign translation never diverges.
 *
 * `Payee` is the merchant field. `Category Group/Category` (the combined
 * column) is preferred for the category over the bare `Category` column,
 * since YNAB categories are hierarchical.
 *
 * Sign convention on output is Plaid's: positive = money out.
 */
import {
  parseCsvFormat,
  headerHasAll,
  twoColumnToSignedAmount,
  type ImportParseResult,
} from "./import";

/** Sniff: the Payee + Outflow + Inflow combination is distinctive to YNAB. */
export function looksLikeYnabCsv(headerRow: string[]): boolean {
  return headerHasAll(headerRow, ["payee", "outflow", "inflow"]);
}

export function parseYnabCsv(text: string): ImportParseResult {
  return parseCsvFormat(text, {
    label: "YNAB",
    merchantLabel: "payee",
    required: {
      date: "date",
      merchant: "payee",
      outflow: "outflow",
      inflow: "inflow",
    },
    optional: {
      combined: "category group/category",
      category: "category",
    },
    amount: (line, cols) => twoColumnToSignedAmount(line[cols.outflow], line[cols.inflow]),
    category: (line, cols) => {
      const combinedIdx = cols.combined;
      const combined = combinedIdx !== undefined ? (line[combinedIdx] ?? "").trim() : "";
      if (combined) return combined;
      const bareIdx = cols.category;
      return bareIdx !== undefined ? (line[bareIdx] ?? "").trim() || null : null;
    },
  });
}