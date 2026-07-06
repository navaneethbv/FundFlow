import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { parseImportCsv, makeImportId, type ImportedRow } from "@/lib/import";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;
const UPSERT_CHUNK = 500;

/**
 * Import pre-Plaid history from a bank-statement CSV into an existing
 * account. Guarantees:
 * - Idempotent: rows get deterministic `import-<hash>` transaction ids, so
 *   re-uploading the same file upserts onto itself.
 * - Pre-Plaid only: rows dated on/after the account's earliest Plaid-synced
 *   transaction are skipped (that's the overlap-dedupe strategy — Plaid rows
 *   carry different ids, so the boundary is the only reliable guard).
 * - Ownership: the target account must belong to the caller (RLS-scoped
 *   lookup); inserts use the service client with explicit user_id.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(`import:${user.id}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many imports. Please wait a while." },
      { status: 429 },
    );
  }

  try {
    const form = await request.formData().catch(() => null);
    if (!form) return badRequest("Expected multipart form data");

    const file = form.get("file");
    const accountId = form.get("account_id");
    const positiveIsIncome = form.get("positive_is_income") === "true";

    if (!(file instanceof File)) return badRequest("file is required");
    if (typeof accountId !== "string" || accountId.length === 0) {
      return badRequest("account_id is required");
    }
    if (file.size > MAX_FILE_BYTES) {
      return badRequest("File too large (2 MB max)");
    }

    // Ownership check runs as the user — RLS hides other users' accounts.
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const text = await file.text();
    const { rows, errors } = parseImportCsv(text, { positiveIsIncome });
    if (rows.length === 0) {
      return badRequest(errors[0] ?? "No importable rows found");
    }
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${MAX_ROWS} max per file)`);
    }

    // Pre-Plaid boundary: earliest transaction on this account that did NOT
    // come from an import.
    const service = createServiceClient();
    const { data: earliestSynced, error: boundaryError } = await service
      .from("transactions")
      .select("date")
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .not("plaid_transaction_id", "like", "import-%")
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (boundaryError) throw boundaryError;
    const boundary = (earliestSynced?.date as string | undefined) ?? null;

    const importable: ImportedRow[] = [];
    let skippedOverlap = 0;
    for (const row of rows) {
      if (boundary && row.date >= boundary) skippedOverlap++;
      else importable.push(row);
    }

    // Deterministic ids; occurrence counter disambiguates identical rows.
    const occurrences = new Map<string, number>();
    const dbRows = importable.map((row) => {
      const key = `${row.date}|${row.amount}|${row.merchant}`;
      const n = occurrences.get(key) ?? 0;
      occurrences.set(key, n + 1);
      return {
        user_id: user.id,
        account_id: accountId,
        plaid_transaction_id: makeImportId(accountId, row, n),
        amount: row.amount,
        date: row.date,
        name: row.merchant,
        merchant_name: row.merchant,
        pfc_primary: row.category
          ? row.category.toUpperCase().replace(/\s+/g, "_")
          : null,
        pending: false,
      };
    });

    for (let i = 0; i < dbRows.length; i += UPSERT_CHUNK) {
      const { error } = await service
        .from("transactions")
        .upsert(dbRows.slice(i, i + UPSERT_CHUNK), {
          onConflict: "plaid_transaction_id",
        });
      if (error) throw error;
    }

    await writeAudit({
      userId: user.id,
      action: "data_import",
      metadata: {
        rows_imported: dbRows.length,
        rows_skipped_overlap: skippedOverlap,
        parse_errors: errors.length,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      ok: true,
      imported: dbRows.length,
      skipped_overlap: skippedOverlap,
      parse_errors: errors.slice(0, 20),
    });
  } catch (error) {
    return errorResponse("import.csv", error);
  }
}
