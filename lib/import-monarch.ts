/**
 * Monarch CSV export import. Monarch's export header is
 * `"Date","Merchant","Category","Account","Original Statement","Notes","Amount","Tags"`.
 *
 * Unlike Mint, Monarch uses a single **signed** `Amount` column whose sign
 * convention is the inverse of Plaid's: a negative amount is an expense, a
 * positive amount is income. The translation rule is therefore a pure sign
 * flip (`ImportedRow.amount = -monarchAmount`) rather than a type-column
 * lookup — there is no additional validation to perform beyond the flip.
 *
 * Sign convention on output is Plaid's: positive = money out.
 */
import {
  parseCsvFormat,
  headerHasAll,
  parseAmount,
  type ImportParseResult,
} from "./import";

/** Sniff: `Merchant` plus `Original Statement` (the pairing is distinctive). */
export function looksLikeMonarchCsv(headerRow: string[]): boolean {
  return headerHasAll(headerRow, ["merchant", "original statement"]);
}

export function parseMonarchCsv(text: string): ImportParseResult {
  return parseCsvFormat(text, {
    label: "Monarch",
    merchantLabel: "merchant",
    required: {
      date: "date",
      merchant: "merchant",
      amount: "amount",
      category: "category",
    },
    amount: (line, cols) => {
      const raw = parseAmount(line[cols.amount] ?? "");
      return raw === null ? null : -raw;
    },
  });
}