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
interface CsvParserState {
  field: string;
  row: string[];
  rows: string[][];
  inQuotes: boolean;
}

function consumeCsvCharacter(
  body: string,
  index: number,
  state: CsvParserState,
  pushField: () => void,
  pushRow: () => void,
): number {
  const ch = body[index]!;
  if (state.inQuotes) {
    if (ch !== '"') {
      state.field += ch;
      return index + 1;
    }
    if (body[index + 1] === '"') {
      state.field += '"';
      return index + 2;
    }
    state.inQuotes = false;
    return index + 1;
  }
  if (ch === '"') {
    state.inQuotes = true;
  } else if (ch === ',') {
    pushField();
  } else if (ch === '\n') {
    pushRow();
  } else if (ch !== '\r') {
    state.field += ch;
  }
  return index + 1;
}

export function parseCsv(text: string): string[][] {
  // A UTF-8 BOM (EF BB BF) lands at the start of text files exported from
  // Excel/Google Sheets; without stripping it the first header cell carries
  // the invisible characters and column auto-detection fails.
  const body = text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
  const state: CsvParserState = { field: "", row: [], rows: [], inQuotes: false };

  const pushField = () => {
    state.row.push(state.field);
    state.field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore fully empty lines.
    if (state.row.length > 1 || state.row[0]!.trim() !== "") state.rows.push(state.row);
    state.row = [];
  };

  for (let i = 0; i < body.length;) {
    i = consumeCsvCharacter(body, i, state, pushField, pushRow);
  }
  if (state.field !== "" || state.row.length > 0) pushRow();
  return state.rows;
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
    const idx = headers.indexOf(candidate);
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

/**
 * Header row plus a few sample rows, for the manual column-mapping UI when
 * auto-detection can't decide. Null when the file has no rows at all.
 */
export function getCsvColumns(text: string): { headers: string[]; sample: string[][] } | null {
  const table = parseCsv(text);
  if (table.length === 0) return null;
  return { headers: table[0]!, sample: table.slice(1, 4) };
}

/**
 * Validate a user-supplied column map against a header of `width` columns:
 * date and description are required and in range, and at least one of amount or
 * debit/credit is mapped. Returns a normalized map, or null when invalid.
 */
export function normalizeColumnMap(input: unknown, width: number): ColumnMap | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const idx = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= width) return null;
    return value;
  };
  const date = idx(raw.date);
  const description = idx(raw.description);
  if (date === null || description === null) return null;
  const amount = idx(raw.amount);
  const debit = idx(raw.debit);
  const credit = idx(raw.credit);
  if (amount === null && debit === null && credit === null) return null;
  return { date, description, amount, debit, credit, category: idx(raw.category) };
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
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Shared two-column (debit/credit or outflow/inflow) to signed amount rule: a
 * nonzero debit/outflow column is positive (money out), a nonzero
 * credit/inflow column is negative (money in). Used by the generic bank-CSV
 * parser and the YNAB normalizer, which share the identical column shape.
 */
export function twoColumnToSignedAmount(
  debitRaw: string | undefined,
  creditRaw: string | undefined,
): number | null {
  const debit = parseAmount(debitRaw ?? "");
  const credit = parseAmount(creditRaw ?? "");
  if (debit !== null && debit !== 0) return Math.abs(debit);
  if (credit !== null && credit !== 0) return -Math.abs(credit);
  return debit !== null || credit !== null ? 0 : null;
}

function parseImportAmount(
  line: string[],
  columns: ColumnMap,
  positiveIsIncome: boolean,
): number | null {
  if (columns.amount !== null) {
    const amount = parseAmount(line[columns.amount] ?? "");
    return amount !== null && positiveIsIncome ? -amount : amount;
  }
  const debitRaw = columns.debit !== null ? line[columns.debit] : undefined;
  const creditRaw = columns.credit !== null ? line[columns.credit] : undefined;
  return twoColumnToSignedAmount(debitRaw, creditRaw);
}

function parseImportLine(
  line: string[],
  lineNo: number,
  columns: ColumnMap,
  positiveIsIncome: boolean,
): { row: ImportedRow } | { error: string } {
  const date = normalizeDate(line[columns.date] ?? "");
  if (!date) {
    return { error: `Line ${lineNo}: unrecognized date "${line[columns.date] ?? ""}".` };
  }
  const amount = parseImportAmount(line, columns, positiveIsIncome);
  if (amount === null) return { error: `Line ${lineNo}: unrecognized amount.` };
  const merchant = (line[columns.description] ?? "").trim();
  if (!merchant) return { error: `Line ${lineNo}: empty description.` };
  return {
    row: {
      date,
      amount: Math.round(amount * 100) / 100,
      merchant,
      category:
        columns.category !== null
          ? (line[columns.category] ?? "").trim() || null
          : null,
    },
  };
}

/**
 * Parse a full statement CSV into normalized rows. Bad lines are reported,
 * never silently dropped; a wholly unusable file returns rows: [] plus the
 * reason in errors.
 */
export function parseImportCsv(
  text: string,
  options: { positiveIsIncome: boolean; columns?: ColumnMap },
): ImportParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { rows: [], errors: ["File has no data rows."] };
  }
  // An explicit map (from the manual column-mapping UI) overrides detection.
  const columns = options.columns ?? detectColumns(table[0]!);
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
    const parsed = parseImportLine(table[i]!, i + 1, columns, options.positiveIsIncome);
    if ("error" in parsed) errors.push(parsed.error);
    else rows.push(parsed.row);
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
