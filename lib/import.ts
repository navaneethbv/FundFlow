import { createHash } from "node:crypto";

/**
 * Bank-statement CSV import: parsing, column auto-detection, and row
 * normalization into the transactions-table shape. Pure logic (unit-test
 * priority); the route wires it to the database.
 *
 * Sign convention on output is Plaid's: positive = money out. Most bank CSVs
 * use the opposite (negative = money out), so callers pass `positiveIsIncome`
 * when the file's positive amounts are deposits.
 */

export interface ImportedRow {
  date: string; // YYYY-MM-DD
  amount: number; // Plaid sign: positive = money out
  merchant: string;
  category: string | null;
}

export interface ImportParseResult {
  rows: ImportedRow[];
  /** Human-readable per-line problems (line numbers are 1-based, incl. header). */
  errors: string[];
}

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore fully empty lines.
    if (row.length > 1 || row[0]!.trim() !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface ColumnMap {
  date: number;
  /** Single signed amount column… */
  amount: number | null;
  /** …or split debit/credit columns. */
  debit: number | null;
  credit: number | null;
  description: number;
  category: number | null;
}

const DATE_HEADERS = ["date", "transaction date", "posted date", "posting date"];
const AMOUNT_HEADERS = ["amount", "transaction amount"];
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawals", "money out"];
const CREDIT_HEADERS = ["credit", "deposit", "deposits", "money in"];
const DESC_HEADERS = ["description", "merchant", "name", "payee", "memo", "details"];
const CATEGORY_HEADERS = ["category", "type"];

function findHeader(headers: string[], candidates: string[]): number | null {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h === candidate);
    if (idx !== -1) return idx;
  }
  // Fall back to prefix matches ("transaction date & time").
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.startsWith(candidate));
    if (idx !== -1) return idx;
  }
  return null;
}

/** Detect the column layout from a header row; null when undecidable. */
export function detectColumns(headerRow: string[]): ColumnMap | null {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const date = findHeader(headers, DATE_HEADERS);
  const description = findHeader(headers, DESC_HEADERS);
  const amount = findHeader(headers, AMOUNT_HEADERS);
  const debit = findHeader(headers, DEBIT_HEADERS);
  const credit = findHeader(headers, CREDIT_HEADERS);
  if (date === null || description === null) return null;
  if (amount === null && debit === null && credit === null) return null;
  return {
    date,
    amount,
    debit,
    credit,
    description,
    category: findHeader(headers, CATEGORY_HEADERS),
  };
}

/** "2026-07-05", "07/05/2026", "7/5/26" → YYYY-MM-DD; null when unparseable. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return toIsoDate(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "$1,234.56" → 1234.56; "(45.00)" → -45; null when not a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^[+-]?\d*\.?\d+$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Parse a full statement CSV into normalized rows. Bad lines are reported,
 * never silently dropped; a wholly unusable file returns rows: [] plus the
 * reason in errors.
 */
export function parseImportCsv(
  text: string,
  options: { positiveIsIncome: boolean },
): ImportParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: ["File has no data rows."] };
  }
  const columns = detectColumns(table[0]!);
  if (!columns) {
    return {
      rows: [],
      errors: [
        "Could not detect columns. The header row needs a date, a description/merchant, and an amount (or debit/credit) column.",
      ],
    };
  }

  const rows: ImportedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < table.length; i++) {
    const line = table[i]!;
    const lineNo = i + 1;

    const date = normalizeDate(line[columns.date] ?? "");
    if (!date) {
      errors.push(`Line ${lineNo}: unrecognized date "${line[columns.date] ?? ""}".`);
      continue;
    }

    let amount: number | null = null;
    if (columns.amount !== null) {
      amount = parseAmount(line[columns.amount] ?? "");
      if (amount !== null && options.positiveIsIncome) amount = -amount;
    } else {
      // Split columns: debit = money out (Plaid-positive), credit = money in.
      const debit = columns.debit !== null ? parseAmount(line[columns.debit] ?? "") : null;
      const credit = columns.credit !== null ? parseAmount(line[columns.credit] ?? "") : null;
      if (debit !== null && debit !== 0) amount = Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = -Math.abs(credit);
      else if (debit !== null || credit !== null) amount = 0;
    }
    if (amount === null) {
      errors.push(`Line ${lineNo}: unrecognized amount.`);
      continue;
    }

    const merchant = (line[columns.description] ?? "").trim();
    if (!merchant) {
      errors.push(`Line ${lineNo}: empty description.`);
      continue;
    }

    rows.push({
      date,
      amount: Math.round(amount * 100) / 100,
      merchant,
      category:
        columns.category !== null ? (line[columns.category] ?? "").trim() || null : null,
    });
  }

  return { rows, errors };
}

/**
 * Deterministic synthetic transaction id: re-importing the same file upserts
 * onto the same ids (idempotent), while `occurrence` disambiguates legitimate
 * identical rows (two same-priced coffees on one day) within a file.
 * The "import-" prefix is the marker that separates imported rows from
 * Plaid-synced ones (the pre-Plaid overlap guard keys off it).
 */
export function makeImportId(
  accountDbId: string,
  row: ImportedRow,
  occurrence: number,
): string {
  const hash = createHash("sha256")
    .update([accountDbId, row.date, row.amount.toFixed(2), row.merchant, occurrence].join("|"))
    .digest("hex")
    .slice(0, 40);
  return `import-${hash}`;
}
