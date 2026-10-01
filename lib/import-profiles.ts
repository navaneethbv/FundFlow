import { createHash } from "node:crypto";
import { getCsvColumns, normalizeColumnMap, normalizeDateWithOrder, parseCsv, parseImportCsv, type ColumnMap, type DateOrder } from "@/lib/import";

export const MAX_IMPORT_PREAMBLE_ROWS = 20;
export interface ImportLayout {
  headerSignature: string;
  columnCount: number;
  columns: ColumnMap;
  dateOrder: DateOrder;
  positiveIsIncome: boolean;
  skipRows: number;
}
export interface ImportProfile { id: string; name: string; layout: ImportLayout }

function signature(headers: string[]): string | null {
  const labels = headers.map(label => label.trim().toLowerCase());
  if (!labels.length || labels.length > 128 || labels.some(label => !label) || new Set(labels).size !== labels.length) return null;
  // Column maps are positional: a reordered header is a different layout.
  return createHash("sha256").update(JSON.stringify(labels)).digest("hex");
}

export function normalizeImportLayout(input: unknown): ImportLayout | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const width = value.columnCount;
  if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 128) return null;
  if (typeof value.headerSignature !== "string" || !/^[a-f0-9]{64}$/.test(value.headerSignature)) return null;
  if (typeof value.skipRows !== "number" || !Number.isInteger(value.skipRows) || value.skipRows < 0 || value.skipRows > MAX_IMPORT_PREAMBLE_ROWS) return null;
  if (value.dateOrder !== "mdy" && value.dateOrder !== "dmy" && value.dateOrder !== "ymd") return null;
  if (typeof value.positiveIsIncome !== "boolean") return null;
  const columns = normalizeColumnMap(value.columns, width);
  if (!columns) return null;
  return { headerSignature: value.headerSignature, columnCount: width, columns, dateOrder: value.dateOrder, positiveIsIncome: value.positiveIsIncome, skipRows: value.skipRows };
}

/** Skip logical CSV records, preserving quoted commas and embedded newlines. */
export function stripImportPreamble(text: string, skipRows: number): string {
  if (!Number.isInteger(skipRows) || skipRows < 0 || skipRows > MAX_IMPORT_PREAMBLE_ROWS) throw new Error("Invalid leading row count");
  if (skipRows === 0) return text;
  return serializeCsv(parseCsv(text).slice(skipRows));
}

function serializeCsv(rows: string[][]): string {
  return rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
}

export function createImportLayout(text: string, options: { columns: unknown; dateOrder?: DateOrder; positiveIsIncome: boolean; skipRows: number }): ImportLayout | null {
  if (!Number.isInteger(options.skipRows) || options.skipRows < 0 || options.skipRows > MAX_IMPORT_PREAMBLE_ROWS) return null;
  const header = getCsvColumns(stripImportPreamble(text, options.skipRows));
  if (!header) return null;
  return normalizeImportLayout({ ...options, headerSignature: signature(header.headers), columnCount: header.headers.length });
}

export function matchImportProfiles(text: string, profiles: ImportProfile[]): ImportProfile[] {
  const table = parseCsv(text);
  return profiles.filter(profile => {
    const layout = normalizeImportLayout(profile.layout);
    const header = layout && table[layout.skipRows];
    return Boolean(header && signature(header) === layout!.headerSignature);
  });
}

export function parseWithImportLayout(text: string, input: ImportLayout) {
  const layout = normalizeImportLayout(input);
  if (!layout) throw new Error("Invalid saved import layout");
  const rows = parseCsv(text).slice(layout.skipRows);
  if (!rows[0] || signature(rows[0]) !== layout.headerSignature) throw new Error("File header does not match saved layout");
  for (const row of rows.slice(1)) {
    // Invalid dates become parse errors, never a fallback to another date order.
    const raw = row[layout.columns.date] ?? "";
    row[layout.columns.date] = layout.dateOrder === "ymd" && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(raw.trim())
      ? "" : normalizeDateWithOrder(raw, layout.dateOrder) ?? "";
  }
  return parseImportCsv(serializeCsv(rows), { columns: layout.columns, positiveIsIncome: layout.positiveIsIncome });
}
