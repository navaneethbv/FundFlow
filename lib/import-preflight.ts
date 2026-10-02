import { detectColumns, normalizeColumnMap, parseAmount, parseCsv, parseImportCsv, type ColumnMap } from "@/lib/import";
import { parseWithImportLayout, type ImportLayout } from "@/lib/import-profiles";

export interface ImportDiagnostic {
  code: string;
  severity: "error" | "warning";
  row: number | null;
  relatedRow?: number;
  message: string;
}
export interface ImportPreflight {
  delimiter: "comma" | "semicolon" | "tab" | "pipe" | "unknown";
  headerRow: number | null;
  totalRows: number;
  validRows: number;
  signConvention: "positive_deposits" | "positive_spend" | "split";
  signBasis: "selected" | "columns";
  inflowRows: number;
  outflowRows: number;
  issues: ImportDiagnostic[];
  issueCount: number;
  truncated: boolean;
  canPreview: boolean;
}
interface RecordLine { text: string; line: number; separators: number[] }

function consumeQuote(text: string, index: number, quoted: boolean) {
  if (quoted && text[index + 1] === '"') return { index: index + 1, quoted };
  return { index, quoted: !quoted };
}

/** Physical line locations include blank lines and embedded quoted newlines. */
function recordsWithLines(text: string): { records: RecordLine[]; unterminated: boolean } {
  const records: RecordLine[] = [];
  let quoted = false;
  let start = 0;
  let line = 1;
  let startLine = 1;
  let separators = [0, 0, 0, 0];
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '"') {
      const next = consumeQuote(text, index, quoted);
      index = next.index; quoted = next.quoted;
    }
    if (!quoted) {
      const delimiter = [",", ";", "\t", "|"].indexOf(character);
      if (delimiter >= 0) separators[delimiter]!++;
    }
    if (character !== "\n") continue;
    line++;
    if (quoted) continue;
    const record = text.slice(start, index).replace(/\r$/, "");
    if (record.trim()) records.push({ text: record, line: startLine, separators });
    start = index + 1; startLine = line; separators = [0, 0, 0, 0];
  }
  const last = text.slice(start);
  if (last.trim()) records.push({ text: last, line: startLine, separators });
  return { records, unterminated: quoted };
}

function detectedDelimiter(records: RecordLine[]): ImportPreflight["delimiter"] {
  const counts = [0, 0, 0, 0];
  for (const record of records.slice(0, 21)) {
    record.separators.forEach((count, index) => { counts[index] = Math.max(counts[index]!, count); });
  }
  const highest = Math.max(...counts);
  if (highest === 0) return "unknown";
  return (["comma", "semicolon", "tab", "pipe"] as const)[counts.indexOf(highest)]!;
}

function amountColumns(columns: ColumnMap): number[] {
  if (columns.amount !== null) return [columns.amount];
  return [columns.debit, columns.credit].filter((index): index is number => index !== null);
}

/** Commas are accepted only as thousands groups, never silently as decimals. */
function safeAmountFormat(raw: string): boolean {
  const value = raw.trim().replace(/[$()\s+-]/g, "");
  return !value.includes(",") || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value);
}

function rowProblems(cells: string[], columns: ColumnMap, hasDateOrder: boolean, line: number): ImportDiagnostic[] {
  const result: ImportDiagnostic[] = [];
  const amountIndexes = amountColumns(columns);
  if (amountIndexes.some(index => !safeAmountFormat(cells[index] ?? ""))) {
    result.push({ code: "amount_format", severity: "error", row: line, message: "Use a decimal point and valid thousands groups for amounts." });
  }
  if (columns.amount === null && amountIndexes.filter(index => (parseAmount(cells[index] ?? "") ?? 0) !== 0).length > 1) {
    result.push({ code: "competing_amounts", severity: "error", row: line, message: "Both debit and credit contain money. Check this row before importing." });
  }
  const date = cells[columns.date]?.trim() ?? "";
  const match = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(date);
  if (!hasDateOrder && match && Number(match[1]) <= 12 && Number(match[2]) <= 12) {
    result.push({ code: "ambiguous_date", severity: "error", row: line, message: "Choose an explicit date format before reviewing this file." });
  }
  return result;
}

function parseErrorCode(message: string): string {
  if (message.includes("date")) return "invalid_date";
  if (message.includes("amount")) return "invalid_amount";
  return "invalid_description";
}

export function inspectImportCsv(text: string, options: { positiveIsIncome: boolean; layout?: ImportLayout; columns?: unknown; skipRows?: number }): ImportPreflight {
  const scan = recordsWithLines(text);
  const delimiter = detectedDelimiter(scan.records);
  const skip = options.layout?.skipRows ?? options.skipRows ?? 0;
  const header = scan.records[skip];
  const table = header ? parseCsv(header.text)[0] ?? [] : [];
  const requestedColumns = options.columns === undefined ? detectColumns(table) : normalizeColumnMap(options.columns, table.length);
  const columns = options.layout?.columns ?? requestedColumns;
  const split = columns?.amount === null;
  const positiveIncome = options.layout?.positiveIsIncome ?? options.positiveIsIncome;
  let signConvention: ImportPreflight["signConvention"] = positiveIncome ? "positive_deposits" : "positive_spend";
  if (split) signConvention = "split";
  const result: ImportPreflight = {
    delimiter, headerRow: header?.line ?? null, totalRows: Math.max(0, scan.records.length - skip - 1), validRows: 0,
    signConvention,
    signBasis: split ? "columns" : "selected", inflowRows: 0, outflowRows: 0,
    issues: [], issueCount: 0, truncated: false, canPreview: false,
  };
  const report = (issue: ImportDiagnostic) => {
    result.issueCount++;
    if (result.issues.length < 100) result.issues.push(issue);
    else result.truncated = true;
  };
  if (!validateFile(scan, result, Boolean(columns), report)) return result;
  analyzeRows(scan.records.slice(skip + 1), header!, columns!, options, result, report);
  return result;
}

function validateFile(scan: ReturnType<typeof recordsWithLines>, result: ImportPreflight, mapped: boolean, report: (issue: ImportDiagnostic) => void): boolean {
  let code: string | undefined;
  let message = "";
  if (scan.unterminated) { code = "quotes"; message = "A quoted field is not closed. Repair the file before importing."; }
  else if (result.delimiter !== "comma") { code = "delimiter"; message = "The import parser needs comma-separated CSV. Export that format before continuing."; }
  else if (result.totalRows === 0) { code = "no_data"; message = "No transaction rows were found."; }
  else if (result.totalRows > 20_000) { code = "row_limit"; message = "Split files larger than 20,000 transaction rows."; }
  else if (!mapped) { code = "mapping"; message = "Choose the date, description, and amount columns before continuing."; }
  if (!code) return true;
  const header = scan.records.slice(0, 21).find(record => detectColumns(parseCsv(record.text)[0] ?? []) !== null);
  if (code === "mapping" && header && header.line !== result.headerRow) {
    report({ code: "header_row", severity: "error", row: header.line, message: `A possible header is on line ${header.line}. Set leading rows to skip, then check again.` });
  } else report({ code, severity: "error", row: null, message });
  return false;
}

function inspectRecord(record: RecordLine, header: RecordLine, columns: ColumnMap, options: { positiveIsIncome: boolean; layout?: ImportLayout }) {
  const cells = parseCsv(record.text)[0] ?? [];
  const problems = rowProblems(cells, columns, Boolean(options.layout), record.line);
  if (cells.length !== (parseCsv(header.text)[0]?.length ?? 0)) problems.push({ code: "row_width", severity: "error", row: record.line, message: "The column count differs from the header. Check separators and quoted values." });
  const source = `${header.text}\n${record.text}`;
  const parsed = options.layout
    ? parseWithImportLayout(source, { ...options.layout, skipRows: 0 })
    : parseImportCsv(source, { columns, positiveIsIncome: options.positiveIsIncome });
  for (const message of parsed.errors) problems.push({ code: parseErrorCode(message), severity: "error", row: record.line, message: message.replace(/^Line \d+: /, "") });
  if (parsed.rows.some(row => !Number.isFinite(row.amount) || Math.abs(row.amount) >= 1e12)) problems.push({ code: "amount_range", severity: "error", row: record.line, message: "Amount exceeds the supported ledger range." });
  return { problems, parsed };
}

function analyzeRows(records: RecordLine[], header: RecordLine, columns: ColumnMap, options: { positiveIsIncome: boolean; layout?: ImportLayout }, result: ImportPreflight, report: (issue: ImportDiagnostic) => void) {
  const seen = new Map<string, number>();
  let hasErrors = false;
  for (const record of records) {
    const { problems, parsed } = inspectRecord(record, header, columns, options);
    problems.forEach(report);
    if (problems.length > 0) { hasErrors = true; continue; }
    const row = parsed.rows[0]!;
    result.validRows++;
    if (row.amount < 0) result.inflowRows++;
    if (row.amount > 0) result.outflowRows++;
    const identity = JSON.stringify([row.date, row.merchant, row.amount]);
    const prior = seen.get(identity);
    if (prior !== undefined) report({ code: "duplicate_row", severity: "warning", row: record.line, relatedRow: prior, message: `Matches the transaction on line ${prior}. Review both entries; repeated purchases can be legitimate.` });
    else seen.set(identity, record.line);
  }
  result.canPreview = !hasErrors && result.validRows > 0;
}
