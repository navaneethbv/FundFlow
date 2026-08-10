import { NextResponse, type NextRequest } from "next/server";
import { buildImportReview } from "@/lib/planning";
import { getCsvColumns, normalizeColumnMap, parseImportCsv, type ColumnMap } from "@/lib/import";
import { looksLikeOfx, parseOfx } from "@/lib/import-ofx";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(`import-preview:${user.id}`, 10, 3600);
  if (!allowed) {
    return badRequest("Too many previews. Please wait a while.");
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
    const isOfx = looksLikeOfx(text);

    // An explicit column map (from the manual-mapping UI) overrides detection.
    const columnMapRaw = form.get("column_map");
    let columns: ColumnMap | undefined;
    if (!isOfx && typeof columnMapRaw === "string" && columnMapRaw.length > 0) {
      const header = getCsvColumns(text);
      const parsed = header ? normalizeColumnMap(JSON.parse(columnMapRaw), header.headers.length) : null;
      if (!parsed) return badRequest("Invalid column mapping. Map at least a date, description, and amount (or debit/credit).");
      columns = parsed;
    }

    const parsed = isOfx
      ? {
          rows: parseOfx(text).map((row) => ({
            date: row.date,
            merchant: row.description,
            amount: row.amount,
            category: null,
          })),
          errors: [] as string[],
        }
      : parseImportCsv(text, { positiveIsIncome, columns });
    const { rows, errors } = parsed;
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${MAX_ROWS} max per file)`);
    }
    if (rows.length === 0) {
      // With no explicit map, auto-detection couldn't produce rows — hand the
      // headers back so the UI can offer manual column mapping instead of a
      // dead-end error.
      if (!isOfx && !columns) {
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
        errors[0] ?? (isOfx ? "No importable OFX rows found" : "No importable rows found"),
      );
    }

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
