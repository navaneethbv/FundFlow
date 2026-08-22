import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { makeImportId } from "@/lib/import";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeImportCategory } from "@/lib/finance-domain";

const UPSERT_CHUNK = 500;

type ImportTarget = { accountId?: string; manualAccountId?: string };
type MappingInput = Record<string, { account_id?: unknown; manual_account_id?: unknown }>;

function targetKey(target: ImportTarget): string {
  return target.accountId ?? `manual-${target.manualAccountId}`;
}

function parseMappingInput(value: unknown): MappingInput {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MappingInput
    : {};
}

/** Ownership check runs as the user — RLS hides other users' accounts. */
async function validateDefaultTarget(
  supabase: SupabaseClient,
  target: ImportTarget,
): Promise<NextResponse | null> {
  if (target.accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", target.accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return null;
  }
  const { data: account } = await supabase
    .from("manual_accounts")
    .select("id")
    .eq("id", target.manualAccountId)
    .maybeSingle();
  if (!account) return NextResponse.json({ error: "Manual account not found" }, { status: 404 });
  return null;
}

/**
 * Staged rows for this batch, excluding whatever's already been committed
 * (a retried/duplicated request must not re-import the same rows). When the
 * caller approves specific ids, rows the preview flagged as "rejected" are
 * still eligible, so the user can override that default.
 */
async function fetchStagedRows(
  supabase: SupabaseClient,
  batchId: string,
  approvedIds: string[] | null,
) {
  let query = supabase
    .from("import_review_rows")
    .select("id, date, description, amount, category, source_account, row_index, status")
    .eq("batch_id", batchId)
    .neq("status", "committed");
  query = approvedIds ? query.in("id", approvedIds) : query.eq("status", "pending");
  const { data: rows, error } = await query;
  if (error) throw error;
  return [...(rows ?? [])].sort((a, b) => Number(a.row_index ?? 0) - Number(b.row_index ?? 0));
}

async function resolveMappings(
  supabase: SupabaseClient,
  sourceAccounts: string[],
  requestedMappings: MappingInput,
  defaultTarget: ImportTarget,
): Promise<{ mappingBySource: Map<string, ImportTarget> } | { error: NextResponse }> {
  const { data: persistedMappings, error } = sourceAccounts.length > 0
    ? await supabase
        .from("import_source_account_mappings")
        .select("source_account, account_id, manual_account_id")
        .in("source_account", sourceAccounts)
    : { data: [], error: null };
  if (error) throw error;

  const mappingBySource = new Map<string, ImportTarget>();
  for (const mapping of persistedMappings ?? []) {
    if (mapping.account_id) mappingBySource.set(mapping.source_account as string, { accountId: mapping.account_id as string });
    else if (mapping.manual_account_id) mappingBySource.set(mapping.source_account as string, { manualAccountId: mapping.manual_account_id as string });
  }
  for (const sourceAccount of sourceAccounts) {
    const requested = requestedMappings[sourceAccount];
    if (requested?.account_id && typeof requested.account_id === "string") {
      mappingBySource.set(sourceAccount, { accountId: requested.account_id });
    } else if (requested?.manual_account_id && typeof requested.manual_account_id === "string") {
      mappingBySource.set(sourceAccount, { manualAccountId: requested.manual_account_id });
    }
  }
  if (sourceAccounts.length === 1 && !mappingBySource.has(sourceAccounts[0]!)) {
    mappingBySource.set(sourceAccounts[0]!, defaultTarget);
  }
  const missingSource = sourceAccounts.find((sourceAccount) => !mappingBySource.has(sourceAccount));
  if (missingSource) {
    return { error: badRequest(`Choose a FundFlow account for source account "${missingSource}"`) };
  }
  return { mappingBySource };
}

async function validateMappedTargets(
  supabase: SupabaseClient,
  mappingBySource: Map<string, ImportTarget>,
  defaultTarget: ImportTarget,
): Promise<NextResponse | null> {
  const mappedTargets = [...mappingBySource.values()].filter((target) => targetKey(target) !== targetKey(defaultTarget));
  const accountTargets = [...new Set(mappedTargets.map((target) => target.accountId).filter((id): id is string => Boolean(id)))];
  const manualTargets = [...new Set(mappedTargets.map((target) => target.manualAccountId).filter((id): id is string => Boolean(id)))];
  if (accountTargets.length > 0) {
    const { data: ownedAccounts } = await supabase.from("accounts").select("id").in("id", accountTargets);
    if ((ownedAccounts ?? []).length !== accountTargets.length) return badRequest("One or more mapped accounts are not available");
  }
  if (manualTargets.length > 0) {
    const { data: ownedManualAccounts } = await supabase.from("manual_accounts").select("id").in("id", manualTargets);
    if ((ownedManualAccounts ?? []).length !== manualTargets.length) return badRequest("One or more mapped manual accounts are not available");
  }
  return null;
}

function buildCommitRows(
  orderedRows: Awaited<ReturnType<typeof fetchStagedRows>>,
  mappingBySource: Map<string, ImportTarget>,
  defaultTarget: ImportTarget,
  userId: string,
) {
  const occurrences = new Map<string, number>();
  return orderedRows.map((row) => {
    const imported = {
      date: row.date as string,
      amount: Number(row.amount),
      merchant: row.description as string,
      category: (row.category as string | null) ?? null,
      sourceAccount: (row.source_account as string | null) ?? null,
    };
    const target = imported.sourceAccount ? mappingBySource.get(imported.sourceAccount)! : defaultTarget;
    const key = `${targetKey(target)}|${imported.date}|${imported.amount}|${imported.merchant}`;
    const n = occurrences.get(key) ?? 0;
    occurrences.set(key, n + 1);
    const category = normalizeImportCategory(imported.category);
    return {
      user_id: userId,
      account_id: target.accountId ?? null,
      manual_account_id: target.manualAccountId ?? null,
      plaid_transaction_id: makeImportId(targetKey(target), imported, n),
      amount: imported.amount,
      date: imported.date,
      name: imported.merchant,
      merchant_name: imported.merchant,
      pfc_primary: category.pfcPrimary,
      pfc_detailed: category.pfcDetailed,
      pending: false,
      // The `import-` prefix (see makeImportId) is what lib/finance-domain.ts
      // actually reads for provenance; this column exists so SQL can filter
      // by source directly (e.g. the ledger's ColumnsMenu) without parsing it.
      source: "import",
    };
  });
}

async function persistCommit(
  service: ReturnType<typeof createServiceClient>,
  params: {
    sourceAccounts: string[];
    mappingBySource: Map<string, ImportTarget>;
    dbRows: ReturnType<typeof buildCommitRows>;
    rowIds: string[];
    batchId: string;
    userId: string;
  },
): Promise<void> {
  const { sourceAccounts, mappingBySource, dbRows, rowIds, batchId, userId } = params;

  if (sourceAccounts.length > 0) {
    const mappingRows = sourceAccounts.map((sourceAccount) => {
      const target = mappingBySource.get(sourceAccount)!;
      return {
        user_id: userId,
        source_account: sourceAccount,
        account_id: target.accountId ?? null,
        manual_account_id: target.manualAccountId ?? null,
      };
    });
    const { error } = await service
      .from("import_source_account_mappings")
      .upsert(mappingRows, { onConflict: "user_id,source_account" });
    if (error) throw error;
  }

  for (let i = 0; i < dbRows.length; i += UPSERT_CHUNK) {
    const { error } = await service
      .from("transactions")
      .upsert(dbRows.slice(i, i + UPSERT_CHUNK), { onConflict: "plaid_transaction_id" });
    if (error) throw error;
  }

  if (rowIds.length > 0) {
    const { error } = await service
      .from("import_review_rows")
      .update({ status: "committed" })
      .eq("user_id", userId)
      .in("id", rowIds);
    if (error) throw error;
  }

  const { error: batchError } = await service
    .from("import_review_batches")
    .update({ status: "committed" })
    .eq("user_id", userId)
    .eq("id", batchId);
  if (batchError) throw batchError;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const batchId = body?.batch_id;
    const accountId = typeof body?.account_id === "string" ? body.account_id : undefined;
    const manualAccountId = typeof body?.manual_account_id === "string" ? body.manual_account_id : undefined;
    const approvedIds: string[] | null = Array.isArray(body?.approved_row_ids) ? body.approved_row_ids : null;
    const requestedMappings = parseMappingInput(body?.account_mappings);
    if (typeof batchId !== "string" || (!accountId && !manualAccountId)) {
      return badRequest("batch_id and account_id are required");
    }

    const defaultTarget: ImportTarget = typeof accountId === "string"
      ? { accountId }
      : { manualAccountId };
    const targetError = await validateDefaultTarget(supabase, defaultTarget);
    if (targetError) return targetError;

    const orderedRows = await fetchStagedRows(supabase, batchId, approvedIds);
    const sourceAccounts = [...new Set(orderedRows.map((row) => row.source_account).filter((value): value is string => Boolean(value)))];

    const mappingResult = await resolveMappings(supabase, sourceAccounts, requestedMappings, defaultTarget);
    if ("error" in mappingResult) return mappingResult.error;
    const { mappingBySource } = mappingResult;

    const mappingError = await validateMappedTargets(supabase, mappingBySource, defaultTarget);
    if (mappingError) return mappingError;

    const dbRows = buildCommitRows(orderedRows, mappingBySource, defaultTarget, user.id);

    const service = createServiceClient();
    await persistCommit(service, {
      sourceAccounts,
      mappingBySource,
      dbRows,
      rowIds: orderedRows.map((row) => row.id as string),
      batchId,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, imported: dbRows.length });
  } catch (error) {
    return errorResponse("import.commit", error);
  }
}
