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
  parseCsv,
  normalizeDate,
  twoColumnToSignedAmount,
  type ImportParseResult,
  type ImportedRow,
} from "./import";

/** Sniff: the Payee + Outflow + Inflow combination is distinctive to YNAB. */
export function looksLikeYnabCsv(headerRow: string[]): boolean {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return (
    headers.includes("payee") &&
    headers.includes("outflow") &&
    headers.includes("inflow")
  );
}

export function parseYnabCsv(text: string): ImportParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: ["File has no data rows."] };
  }
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const payeeIdx = header.indexOf("payee");
  const outflowIdx = header.indexOf("outflow");
  const inflowIdx = header.indexOf("inflow");
  const combinedCatIdx = header.indexOf("category group/category");
  const bareCatIdx = header.indexOf("category");
  if (dateIdx === -1 || payeeIdx === -1 || outflowIdx === -1 || inflowIdx === -1) {
    return {
      rows: [],
      errors: [
        "Could not detect YNAB columns. The header needs Date, Payee, Outflow, and Inflow.",
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

    const amount = twoColumnToSignedAmount(line[outflowIdx], line[inflowIdx]);
    if (amount === null) {
      errors.push(`Line ${lineNo}: unrecognized amount.`);
      continue;
    }

    const merchant = (line[payeeIdx] ?? "").trim();
    if (!merchant) {
      errors.push(`Line ${lineNo}: empty payee.`);
      continue;
    }

    const categoryRaw =
      combinedCatIdx !== -1 && (line[combinedCatIdx] ?? "").trim() !== ""
        ? (line[combinedCatIdx] ?? "").trim()
        : bareCatIdx !== -1
          ? (line[bareCatIdx] ?? "").trim()
          : "";

    rows.push({
      date,
      amount: Math.round(amount * 100) / 100,
      merchant,
      category: categoryRaw || null,
    });
  }

  return { rows, errors };
}
