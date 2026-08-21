import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import {
  parseImportCsv,
  makeImportId,
  detectSourceFormat,
  type DateOrder,
  type ImportedRow,
} from "@/lib/import";
import { parseOfx } from "@/lib/import-ofx";
import { parseMintCsv } from "@/lib/import-mint";
import { parseMonarchCsv } from "@/lib/import-monarch";
import { parseYnabCsv } from "@/lib/import-ynab";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;
const UPSERT_CHUNK = 500;

function parseUploadedRows(
  text: string,
  positiveIsIncome: boolean,
  dateOrder?: DateOrder,
): { rows: ImportedRow[]; errors: string[]; requiresDateOrder?: boolean } {
  switch (detectSourceFormat(text)) {
    case "ofx":
      return {
        rows: parseOfx(text).map((transaction) => ({
          date: transaction.date,
          amount: transaction.amount,
          merchant: transaction.description || "Imported",
          category: null,
        })),
        errors: [],
      };
    case "mint":
      return parseMintCsv(text);
    case "monarch":
      return parseMonarchCsv(text);
    case "ynab":
      return parseYnabCsv(text, { dateOrder, requireDateOrder: !dateOrder });
    default:
      return parseImportCsv(text, { positiveIsIncome });
  }
}

function filterOverlappingRows(
  rows: ImportedRow[],
  boundary: string | null,
): { importable: ImportedRow[]; skippedOverlap: number } {
  const importable: ImportedRow[] = [];
  let skippedOverlap = 0;
  for (const row of rows) {
    if (boundary && row.date >= boundary) skippedOverlap++;
    else importable.push(row);
  }
  return { importable, skippedOverlap };
}

function buildDatabaseRows(
  rows: ImportedRow[],
  userId: string,
  target: { accountId?: string; manualAccountId?: string },
) {
  const targetKey = target.accountId ?? `manual-${target.manualAccountId}`;
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const key = `${row.date}|${row.amount}|${row.merchant}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return {
      user_id: userId,
      account_id: target.accountId ?? null,
      manual_account_id: target.manualAccountId ?? null,
      plaid_transaction_id: makeImportId(targetKey, row, occurrence),
      amount: row.amount,
      date: row.date,
      name: row.merchant,
      merchant_name: row.merchant,
      pfc_primary: row.category
        ? row.category.toUpperCase().replace(/\s+/g, "_")
        : null,
      pending: false,
      source: "import",
    };
  });
}

async function upsertDatabaseRows(
  service: ReturnType<typeof createServiceClient>,
  rows: ReturnType<typeof buildDatabaseRows>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await service
      .from("transactions")
      .upsert(rows.slice(i, i + UPSERT_CHUNK), {
        onConflict: "plaid_transaction_id",
      });
    if (error) throw error;
  }
}

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
    const manualAccountId = form.get("manual_account_id");
    const positiveIsIncome = form.get("positive_is_income") === "true";
    const dateOrderRaw = form.get("date_order");
    const dateOrder = dateOrderRaw === "mdy" || dateOrderRaw === "dmy" || dateOrderRaw === "ymd" ? dateOrderRaw : undefined;

    if (!(file instanceof File)) return badRequest("file is required");
    if ((typeof accountId !== "string" || accountId.length === 0) && (typeof manualAccountId !== "string" || manualAccountId.length === 0)) {
      return badRequest("account_id is required");
    }
    if (file.size > MAX_FILE_BYTES) {
      return badRequest("File too large (2 MB max)");
    }

    // Ownership check runs as the user — RLS hides other users' accounts.
    if (typeof accountId === "string" && accountId.length > 0) {
      const { data: account } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", accountId)
        .maybeSingle();
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    } else {
      const { data: account } = await supabase
        .from("manual_accounts")
        .select("id")
        .eq("id", manualAccountId)
        .maybeSingle();
      if (!account) return NextResponse.json({ error: "Manual account not found" }, { status: 404 });
    }

    const text = await file.text();
    const { rows, errors, requiresDateOrder } = parseUploadedRows(text, positiveIsIncome, dateOrder);
    if (requiresDateOrder) {
      return badRequest("YNAB dates are ambiguous. Choose a date format and upload again.");
    }
    if (rows.length === 0) {
      return badRequest(errors[0] ?? "No importable rows found");
    }
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${MAX_ROWS} max per file)`);
    }

    // Pre-Plaid boundary: earliest transaction on this account that did NOT
    // come from an import.
    const service = createServiceClient();
    let boundaryQuery = service
      .from("transactions")
      .select("date")
      .eq("user_id", user.id);
    boundaryQuery = typeof accountId === "string" && accountId.length > 0
      ? boundaryQuery.eq("account_id", accountId)
      : boundaryQuery.eq("manual_account_id", manualAccountId);
    const { data: earliestSynced, error: boundaryError } = await boundaryQuery
      .not("plaid_transaction_id", "like", "import-%")
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (boundaryError) throw boundaryError;
    const boundary = (earliestSynced?.date as string | undefined) ?? null;

    const sourceAccounts = [...new Set(rows.map((row) => row.sourceAccount).filter((value): value is string => Boolean(value)))];
    if (sourceAccounts.length > 1) {
      return badRequest("This export contains multiple source accounts. Use Import with review to map each source account.");
    }
    const target = typeof accountId === "string" && accountId.length > 0
      ? { accountId }
      : { manualAccountId: manualAccountId as string };
    const { importable, skippedOverlap } = filterOverlappingRows(rows, boundary);
    const dbRows = buildDatabaseRows(importable, user.id, target);
    await upsertDatabaseRows(service, dbRows);

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
