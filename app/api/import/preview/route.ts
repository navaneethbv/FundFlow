import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildImportReview } from "@/lib/planning";
import {
  getCsvColumns,
  normalizeColumnMap,
  parseImportCsv,
  detectSourceFormat,
  type DateOrder,
  type ImportedRow,
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
const EXISTING_TRANSACTION_PAGE_SIZE = 1_000;
const DATABASE_CHUNK_SIZE = 500;

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
  options: { positiveIsIncome: boolean; columns?: ColumnMap; dateOrder?: DateOrder },
): { rows: ImportedRow[]; errors: string[]; requiresDateOrder?: boolean } {
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
      return parseMintCsv(text, { dateOrder: options.dateOrder, requireDateOrder: !options.dateOrder });
    case "monarch":
      return parseMonarchCsv(text, { dateOrder: options.dateOrder, requireDateOrder: !options.dateOrder });
    case "ynab":
      return parseYnabCsv(text, { dateOrder: options.dateOrder, requireDateOrder: !options.dateOrder });
    case "csv":
    default:
      return parseImportCsv(text, options);
  }
}

function parsePreviewInput(
  text: string,
  positiveIsIncome: boolean,
  columnMapRaw: FormDataEntryValue | null,
  dateOrder?: DateOrder,
): { rows: ImportedRow[]; errors: string[]; format: ImportSourceFormat; columns?: ColumnMap; mappingError?: string; requiresDateOrder?: boolean } {
  const format = detectSourceFormat(text);
  let columns: ColumnMap | undefined;
  if (format === "csv") {
    const mapping = resolveColumnMap(text, columnMapRaw);
    if (mapping.error) {
      return { rows: [], errors: [], format, mappingError: mapping.error };
    }
    columns = mapping.columns;
  }
  const parsed = parseByFormat(text, format, { positiveIsIncome, columns, dateOrder });
  return { ...parsed, format, columns };
}

function emptyPreviewResponse(
  text: string,
  format: ImportSourceFormat,
  columns: ColumnMap | undefined,
  errors: string[],
  requiresDateOrder = false,
): NextResponse {
  if (requiresDateOrder) {
    return NextResponse.json({
      needs_date_format: true,
      parse_errors: errors.slice(0, 20),
    });
  }
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

function transactionLabel(row: Record<string, unknown>): string {
  const value = row.merchant_name ?? row.name;
  return typeof value === "string" ? value : "";
}

async function resolveSourceAccountMappings(
  supabase: SupabaseClient,
  userId: string,
  sourceAccounts: string[],
): Promise<Record<string, { account_id?: string; manual_account_id?: string }>> {
  if (sourceAccounts.length === 0) return {};
  const mappings: Array<Record<string, unknown>> = [];
  for (let index = 0; index < sourceAccounts.length; index += DATABASE_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("import_source_account_mappings")
      .select("source_account, account_id, manual_account_id")
      .in("source_account", sourceAccounts.slice(index, index + DATABASE_CHUNK_SIZE))
      .eq("user_id", userId);
    if (error) throw error;
    mappings.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  return Object.fromEntries(
    mappings.map((mapping) => [mapping.source_account as string, {
      ...(mapping.account_id ? { account_id: mapping.account_id as string } : {}),
      ...(mapping.manual_account_id ? { manual_account_id: mapping.manual_account_id as string } : {}),
    }]),
  );
}

async function loadExistingTransactions(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += EXISTING_TRANSACTION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, date, amount, merchant_name, name, pfc_primary")
      .eq("user_id", userId)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + EXISTING_TRANSACTION_PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...pageRows);
    if (pageRows.length < EXISTING_TRANSACTION_PAGE_SIZE) break;
  }
  return rows;
}

async function stagePreviewRows(
  service: SupabaseClient,
  batchId: string,
  userId: string,
  stagedRows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const insertedRows: Array<Record<string, unknown>> = [];
  try {
    for (let index = 0; index < stagedRows.length; index += DATABASE_CHUNK_SIZE) {
      const { data, error } = await service
        .from("import_review_rows")
        .insert(stagedRows.slice(index, index + DATABASE_CHUNK_SIZE))
        .select("id, date, description, amount, source_account, row_index, status");
      if (error) throw error;
      insertedRows.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
    return insertedRows;
  } catch (stagingError) {
    const { error: cleanupError } = await service
      .from("import_review_batches")
      .delete()
      .eq("id", batchId)
      .eq("user_id", userId);
    if (cleanupError) {
      throw new AggregateError(
        [stagingError, cleanupError],
        "Failed to stage import rows and clean up the pending batch",
      );
    }
    throw stagingError;
  }
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
    const dateOrderRaw = form.get("date_order");
    const dateOrder = dateOrderRaw === "mdy" || dateOrderRaw === "dmy" || dateOrderRaw === "ymd" ? dateOrderRaw : undefined;
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > MAX_FILE_BYTES) {
      return badRequest("File too large (2 MB max)");
    }

    const text = await file.text();
    const parsed = parsePreviewInput(text, positiveIsIncome, form.get("column_map"), dateOrder);
    const { rows, errors, format, columns } = parsed;
    if (parsed.mappingError) return badRequest(parsed.mappingError);
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${MAX_ROWS} max per file)`);
    }
    if (rows.length === 0) return emptyPreviewResponse(text, format, columns, errors, parsed.requiresDateOrder);

    const existing = await loadExistingTransactions(supabase, user.id);
    const existingFingerprints = new Set(
      (existing ?? []).map((row) => `${row.date}|${Number(row.amount).toFixed(2)}|${transactionLabel(row)}`),
    );
    // Plaid-vs-Monarch classification conflicts: keyed by the same fingerprint
    // so a matching existing transaction surfaces a category-conflict flag.
    const existingCategoryByFingerprint = new Map<string, string>(
      (existing ?? []).map((row) => [
        `${row.date}|${Number(row.amount).toFixed(2)}|${transactionLabel(row)}`,
        (row.pfc_primary as string | null) ?? "",
      ]),
    );
    const review = buildImportReview(rows, existingFingerprints, existingCategoryByFingerprint);

    const sourceAccounts = [...new Set(rows.map((row) => row.sourceAccount).filter((value): value is string => Boolean(value)))];
    const sourceAccountMappings = await resolveSourceAccountMappings(supabase, user.id, sourceAccounts);

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
    if (!batch?.id) throw new Error("import_preview_batch_not_created");

    const batchId = batch.id as string;
    // Flagged rows (file or possible duplicates) default to "rejected" so the
    // safe default only imports clean rows; the user can still opt them back in.
    const stagedRows = review.rows.map((row, index) => ({
      user_id: user.id,
      batch_id: batchId,
      row_hash: row.rowHash,
      date: row.row.date,
      description: row.row.merchant,
      amount: row.row.amount,
      category: row.row.category,
      source_account: row.row.sourceAccount ?? null,
      notes: row.row.notes ?? null,
      tags: row.row.tags ?? [],
      row_index: index,
      status: row.flags.length > 0 ? "rejected" : "pending",
    }));
    const insertedRows = await stagePreviewRows(service, batchId, user.id, stagedRows);

    const rowsOut = [...insertedRows]
      .sort((a, b) => Number(a.row_index ?? 0) - Number(b.row_index ?? 0))
      .map((row, index) => ({
      id: row.id as string,
      date: row.date as string,
      description: row.description as string,
      amount: Number(row.amount),
      ...(row.source_account ? { source_account: row.source_account as string } : {}),
      status: row.status as string,
      flags: review.rows[index]?.flags ?? [],
      }));

    return NextResponse.json({
      batch_id: batchId,
      rows: rowsOut,
      ...(sourceAccounts.length > 0 ? { source_accounts: sourceAccounts, source_account_mappings: sourceAccountMappings } : {}),
      parse_errors: errors.slice(0, 20),
    });
  } catch (error) {
    return errorResponse("import.preview", error);
  }
}
