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
  parseCsv,
  normalizeDate,
  parseAmount,
  type ImportParseResult,
  type ImportedRow,
} from "./import";

/** Sniff: `Merchant` plus `Original Statement` (the pairing is distinctive). */
export function looksLikeMonarchCsv(headerRow: string[]): boolean {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return headers.includes("merchant") && headers.includes("original statement");
}

export function parseMonarchCsv(text: string): ImportParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: ["File has no data rows."] };
  }
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const merchantIdx = header.indexOf("merchant");
  const amountIdx = header.indexOf("amount");
  const catIdx = header.indexOf("category");
  if (dateIdx === -1 || merchantIdx === -1 || amountIdx === -1) {
    return {
      rows: [],
      errors: [
        "Could not detect Monarch columns. The header needs Date, Merchant, and Amount.",
      ],
    };
  }

  const rows: ImportedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < table.length; i++) {
    const line = table[i]!;
    const lineNo = i + 1;

    const date = normalizeDate(line[dateIdx] ?? "");
    if (!date) {
      errors.push(`Line ${lineNo}: unrecognized date "${line[dateIdx] ?? ""}".`);
      continue;
    }

    const rawAmount = parseAmount(line[amountIdx] ?? "");
    if (rawAmount === null) {
      errors.push(`Line ${lineNo}: unrecognized amount.`);
      continue;
    }

    const merchant = (line[merchantIdx] ?? "").trim();
    if (!merchant) {
      errors.push(`Line ${lineNo}: empty merchant.`);
      continue;
    }

    // Sign flip: Monarch expense (negative) -> Plaid money-out (positive).
    const amount = -rawAmount;
    rows.push({
      date,
      amount: Math.round(amount * 100) / 100,
      merchant,
      category:
        catIdx !== -1 ? (line[catIdx] ?? "").trim() || null : null,
    });
  }

  return { rows, errors };
}
