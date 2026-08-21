/**
 * Mint.com CSV export import. Mint's export header is
 * `"Date","Description","Original Description","Amount","Transaction Type","Category","Account Name","Labels","Notes"`.
 *
 * Unlike a plain bank CSV, Mint's `Amount` column is always a positive
 * magnitude regardless of direction; the sign lives entirely in the
 * `Transaction Type` column (`"debit"` = money out, `"credit"` = money in).
 * We therefore never trust the raw amount's own sign (a debit row whose
 * Amount is exported negative must still become a positive Plaid amount).
 *
 * Sign convention on output is Plaid's: positive = money out.
 */
import {
  parseCsvFormat,
  headerHasAll,
  parseAmount,
  type ImportParseResult,
} from "./import";

/** Sniff: Mint's two most distinctive column names. */
export function looksLikeMintCsv(headerRow: string[]): boolean {
  return headerHasAll(headerRow, ["transaction type", "original description"]);
}

export function parseMintCsv(text: string): ImportParseResult {
  return parseCsvFormat(text, {
    label: "Mint",
    merchantLabel: "description",
    required: {
      date: "date",
      merchant: "description",
      amount: "amount",
      type: "transaction type",
      category: "category",
    },
    amount: (line, cols) => {
      const type = (line[cols.type] ?? "").trim().toLowerCase();
      if (type !== "debit" && type !== "credit") return null;
      const magnitude = parseAmount(line[cols.amount] ?? "");
      if (magnitude === null) return null;
      return type === "debit" ? Math.abs(magnitude) : -Math.abs(magnitude);
    },
  });
}