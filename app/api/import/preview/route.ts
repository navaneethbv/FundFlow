import { NextResponse, type NextRequest } from "next/server";
import { buildImportReview } from "@/lib/planning";
import {
  getCsvColumns,
  normalizeColumnMap,
  parseImportCsv,
  detectSourceFormat,
  type ColumnMap,
  type ImportSourceFormat,
} from "@/lib/import";
import { parseOfx } from "@/lib/import-ofx";
import { parseMintCsv } from "@/lib/import-mint";
import { parseMonarchCsv } from "@/lib/import-monarch";
import { parseYnabCsv } from "@/lib/import-ynab";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;

const INVALID_MAPPING_ERROR =
  "Invalid column mapping. Map at least a date, description, and amount (or debit/credit).";

function resolveColumnMap(
  text: string,
  columnMapRaw: FormDataEntryValue | null,
): { columns?: ColumnMap; error?: string } {
  if (typeof columnMapRaw !== "string" || columnMapRaw.length === 0) {
    return {};
  }
  const header = getCsvColumns(text);
  if (!header) return { error: INVALID_MAPPING_ERROR };
  try {
    const parsed = normalizeColumnMap(JSON.parse(columnMapRaw), header.headers.length);
    return parsed ? { columns: parsed } : { error: INVALID_MAPPING_ERROR };
  } catch {
    return { error: INVALID_MAPPING_ERROR };
  }
}

function parseByFormat(
  text: string,
  format: ImportSourceFormat,
  options: { positiveIsIncome: boolean; columns?: ColumnMap },
): { rows: Array<{ date: string; merchant: string; amount: number; category: string | null }>; errors: string[] } {
  switch (format) {
    case "ofx":
      return {
        rows: parseOfx(text).map((row) => ({
          date: row.date,
          merchant: row.description,
          amount: row.amount,
          category: null,
        })),
        errors: [],
      };
    case "mint":
      return parseMintCsv(text);
    case "monarch":
      return parseMonarchCsv(text);
    case "ynab":
      return parseYnabCsv(text);
    case "csv":
    default:
      return parseImportCsv(text, options);
  }
}

function parsePreviewInput(
  text: string,
  positiveIsIncome: boolean,
  columnMapRaw: FormDataEntryValue | null,
): { rows: Array<{ date: string; merchant: string; amount: number; category: string | null }>; errors: string[]; format: ImportSourceFormat; columns?: ColumnMap; mappingError?: string } {
  const format = detectSourceFormat(text);
  let columns: ColumnMap | undefined;
  if (format === "csv") {
    const mapping = resolveColumnMap(text, columnMapRaw);
    if (mapping.error) {
      return { rows: [], errors: [], format, mappingError: mapping.error };
    }
    columns = mapping.columns;
  }
  const parsed = parseByFormat(text, format, { positiveIsIncome, columns });
  return { ...parsed, format, columns };
}

function emptyPreviewResponse(
  text: string,
  format: ImportSourceFormat,
  columns: ColumnMap | undefined,
  errors: string[],
): NextResponse {
  if (format === "csv" && !columns) {
    const header = getCsvColumns(text);
    if (header && header.headers.length > 0) {
      return NextResponse.json({
        needs_mapping: true,
        headers: header.headers,
        sample: header.sample,
        parse_errors: errors.slice(0, 20),
      });
    }
  }
  return badRequest(
    errors[0] ??
      (format === "ofx" ? "No importable OFX rows found" : "No importable rows found"),
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(`import-preview:${user.id}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many previews. Please wait a while." },
      { status: 429 },
    );
  }

  try {
    const form = await request.formData().catch(() => null);
    if (!form) return badRequest("Expected multipart form data");

    const file = form.get("file");
    const positiveIsIncome = form.get("positive_is_income") !== "false";
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > MAX_FILE_BYTES) {
      return badRequest("File too large (2 MB max)");
    }

    const text = await file.text();
    const parsed = parsePreviewInput(text, positiveIsIncome, form.get("column_map"));
    const { rows, errors, format, columns } = parsed;
    if (parsed.mappingError) return badRequest(parsed.mappingError);
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${MAX_ROWS} max per file)`);
    }
    if (rows.length === 0) return emptyPreviewResponse(text, format, columns, errors);

    const { data: existing } = await supabase
      .from("transactions")
      .select("date, amount, merchant_name, name")
      .limit(20_000);
    const existingFingerprints = new Set(
      (existing ?? []).map((row) => `${row.date}|${Number(row.amount).toFixed(2)}|${row.merchant_name ?? row.name ?? ""}`),
    );
    const review = buildImportReview(rows, existingFingerprints);

    const service = createServiceClient();
    const { data: batch, error: batchError } = await service
      .from("import_review_batches")
      .insert({
        user_id: user.id,
        file_name: file.name || "statement.csv",
        status: "pending",
      })
      .select("id")
      .single();
    if (batchError) throw batchError;

    const batchId = batch.id as string;
    // Flagged rows (file or possible duplicates) default to "rejected" so the
    // safe default only imports clean rows; the user can still opt them back in.
    const { data: insertedRows, error: rowsError } = await service
      .from("import_review_rows")
      .insert(
        review.rows.map((row) => ({
          user_id: user.id,
          batch_id: batchId,
          row_hash: row.rowHash,
          date: row.row.date,
          description: row.row.merchant,
          amount: row.row.amount,
          category: row.row.category,
          status: row.flags.length > 0 ? "rejected" : "pending",
        })),
      )
      .select("id, date, description, amount, status");
    if (rowsError) throw rowsError;

    // PostgREST returns inserted rows in input order, so flags align by index.
    const rowsOut = (insertedRows ?? []).map((row, index) => ({
      id: row.id as string,
      date: row.date as string,
      description: row.description as string,
      amount: Number(row.amount),
      status: row.status as string,
      flags: review.rows[index]?.flags ?? [],
    }));

    return NextResponse.json({
      batch_id: batchId,
      rows: rowsOut,
      parse_errors: errors.slice(0, 20),
    });
  } catch (error) {
    return errorResponse("import.preview", error);
  }
}
