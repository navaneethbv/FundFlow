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
  parseCsv,
  normalizeDate,
  parseAmount,
  type ImportParseResult,
  type ImportedRow,
} from "./import";

/** Sniff: Mint's two most distinctive column names. */
export function looksLikeMintCsv(headerRow: string[]): boolean {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return headers.includes("transaction type") && headers.includes("original description");
}

export function parseMintCsv(text: string): ImportParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: ["File has no data rows."] };
  }
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const descIdx = header.indexOf("description");
  const amountIdx = header.indexOf("amount");
  const typeIdx = header.indexOf("transaction type");
  const catIdx = header.indexOf("category");
  if (dateIdx === -1 || descIdx === -1 || amountIdx === -1 || typeIdx === -1) {
    return {
      rows: [],
      errors: [
        "Could not detect Mint columns. The header needs Date, Description, Amount, and Transaction Type.",
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

    const type = (line[typeIdx] ?? "").trim().toLowerCase();
    if (type !== "debit" && type !== "credit") {
      errors.push(`Line ${lineNo}: unrecognized Transaction Type "${line[typeIdx] ?? ""}".`);
      continue;
    }

    const magnitude = parseAmount(line[amountIdx] ?? "");
    if (magnitude === null) {
      errors.push(`Line ${lineNo}: unrecognized amount.`);
      continue;
    }

    const merchant = (line[descIdx] ?? "").trim();
    if (!merchant) {
      errors.push(`Line ${lineNo}: empty description.`);
      continue;
    }

    const amount = type === "debit" ? Math.abs(magnitude) : -Math.abs(magnitude);
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
