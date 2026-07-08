import { NextResponse, type NextRequest } from "next/server";
import { buildImportReview } from "@/lib/planning";
import { parseImportCsv } from "@/lib/import";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const form = await request.formData().catch(() => null);
    if (!form) return badRequest("Expected multipart form data");

    const file = form.get("file");
    const positiveIsIncome = form.get("positive_is_income") !== "false";
    if (!(file instanceof File)) return badRequest("file is required");

    const text = await file.text();
    const { rows, errors } = parseImportCsv(text, { positiveIsIncome });
    if (rows.length === 0) return badRequest(errors[0] ?? "No importable rows found");

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
    const { error: rowsError } = await service.from("import_review_rows").insert(
      review.rows.map((row) => ({
        user_id: user.id,
        batch_id: batchId,
        row_hash: row.rowHash,
        date: row.row.date,
        description: row.row.merchant,
        amount: row.row.amount,
        status: row.flags.includes("file-duplicate") ? "rejected" : "pending",
      })),
    );
    if (rowsError) throw rowsError;

    return NextResponse.json({
      batch_id: batchId,
      rows: review.rows,
      parse_errors: errors.slice(0, 20),
    });
  } catch (error) {
    return errorResponse("import.preview", error);
  }
}
