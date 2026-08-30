import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { makeImportId } from "@/lib/import";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeImportCategory } from "@/lib/finance-domain";

const UPSERT_CHUNK = 500;
const QUERY_CHUNK = 500;
const BATCH_PAGE_SIZE = 1_000;

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

function chunks<T>(values: T[], size = QUERY_CHUNK): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function persistedMappingTarget(mapping: Record<string, unknown>): ImportTarget | null {
  if (typeof mapping.account_id === "string") return { accountId: mapping.account_id };
  if (typeof mapping.manual_account_id === "string") {
    return { manualAccountId: mapping.manual_account_id };
  }
  return null;
}

function requestedMappingTarget(mapping: MappingInput[string] | undefined): ImportTarget | null {
  if (typeof mapping?.account_id === "string") return { accountId: mapping.account_id };
  if (typeof mapping?.manual_account_id === "string") {
    return { manualAccountId: mapping.manual_account_id };
  }
  return null;
}

async function loadOwnedBatch(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await supabase
    .from("import_review_batches")
    .select("id, created_at")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; created_at: string } | null;
}

/** Account targets must be owned, not merely household-visible through RLS. */
async function validateDefaultTarget(
  supabase: SupabaseClient,
  target: ImportTarget,
  userId: string,
): Promise<NextResponse | null> {
  if (target.accountId) {
    const { data: account, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", target.accountId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return null;
  }
  const { data: account, error } = await supabase
    .from("manual_accounts")
    .select("id")
    .eq("id", target.manualAccountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!account) return NextResponse.json({ error: "Manual account not found" }, { status: 404 });
  return null;
}

/**
 * Every row staged for this batch, in file order — including rows already
 * committed and rows the preview rejected. The full set is what makes the
 * import id stable: `makeImportId` disambiguates byte-identical rows by their
 * occurrence number, so that number has to be counted over the whole file. A
 * partial commit that counted only its own slice would restart at zero and
 * hand the second half ids the first half already used, silently upserting
 * one transaction over the other.
 */
async function fetchBatchRows(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
) {
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += BATCH_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("import_review_rows")
      .select("id, date, description, amount, category, source_account, notes, tags, row_index, status")
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .order("row_index", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < BATCH_PAGE_SIZE) return rows;
  }
}

/**
 * Which of the batch's rows this request actually commits. Already-committed
 * rows are never re-imported (a retried or duplicated request must be a
 * no-op). When the caller approves specific ids, rows the preview flagged as
 * "rejected" are still eligible, so the user can override that default.
 */
function selectCommittableRows(
  batchRows: Awaited<ReturnType<typeof fetchBatchRows>>,
  approvedIds: string[] | null,
) {
  const approved = approvedIds ? new Set(approvedIds) : null;
  return batchRows.filter((row) =>
    row.status !== "committed" &&
    (approved ? approved.has(row.id as string) : row.status === "pending"),
  );
}

async function resolveMappings(
  supabase: SupabaseClient,
  userId: string,
  sourceAccounts: string[],
  requestedMappings: MappingInput,
  defaultTarget: ImportTarget,
): Promise<{ mappingBySource: Map<string, ImportTarget> } | { error: NextResponse }> {
  const persistedMappings: Array<Record<string, unknown>> = [];
  for (const sourceAccountChunk of chunks(sourceAccounts)) {
    const { data, error } = await supabase
        .from("import_source_account_mappings")
        .select("source_account, account_id, manual_account_id")
        .in("source_account", sourceAccountChunk)
        .eq("user_id", userId);
    if (error) throw error;
    persistedMappings.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  const mappingBySource = new Map<string, ImportTarget>();
  for (const mapping of persistedMappings) {
    const target = persistedMappingTarget(mapping);
    if (target) mappingBySource.set(mapping.source_account as string, target);
  }
  for (const sourceAccount of sourceAccounts) {
    const target = requestedMappingTarget(requestedMappings[sourceAccount]);
    if (target) mappingBySource.set(sourceAccount, target);
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
  userId: string,
): Promise<NextResponse | null> {
  const mappedTargets = [...mappingBySource.values()].filter((target) => targetKey(target) !== targetKey(defaultTarget));
  const accountTargets = [...new Set(mappedTargets.map((target) => target.accountId).filter((id): id is string => Boolean(id)))];
  const manualTargets = [...new Set(mappedTargets.map((target) => target.manualAccountId).filter((id): id is string => Boolean(id)))];
  const ownedAccountIds = new Set<string>();
  for (const accountTargetChunk of chunks(accountTargets)) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .in("id", accountTargetChunk)
      .eq("user_id", userId);
    if (error) throw error;
    for (const account of data ?? []) ownedAccountIds.add(account.id as string);
  }
  if (ownedAccountIds.size !== accountTargets.length) {
    return badRequest("One or more mapped accounts are not available");
  }
  const ownedManualAccountIds = new Set<string>();
  for (const manualTargetChunk of chunks(manualTargets)) {
    const { data, error } = await supabase
      .from("manual_accounts")
      .select("id")
      .in("id", manualTargetChunk)
      .eq("user_id", userId);
    if (error) throw error;
    for (const account of data ?? []) ownedManualAccountIds.add(account.id as string);
  }
  if (ownedManualAccountIds.size !== manualTargets.length) {
    return badRequest("One or more mapped manual accounts are not available");
  }
  return null;
}

/**
 * Numbers every row in the batch, then keeps only the ones being committed.
 * The occurrence counter has to advance across skipped and already-committed
 * rows too, or a second partial commit reuses the first one's import ids.
 */
function buildCommitRows(
  batchRows: Awaited<ReturnType<typeof fetchBatchRows>>,
  committableIds: Set<string>,
  mappingBySource: Map<string, ImportTarget>,
  defaultTarget: ImportTarget,
  userId: string,
) {
  const occurrences = new Map<string, number>();
  const dbRows = [];
  for (const row of batchRows) {
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
    if (!committableIds.has(row.id as string)) continue;
    const category = normalizeImportCategory(imported.category);
    dbRows.push({
      rowId: row.id as string,
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
      // Monarch notes/tags, persisted as annotations after the row lands.
      note: (row.notes as string | null) ?? null,
      tags: (row.tags as string[] | null) ?? [],
    });
  }
  return dbRows;
}

/**
 * Refuse to overwrite a newer FundFlow edit. When a committed row carries
 * notes/tags and the matching transaction already has an annotation edited
 * after the batch was created, the caller must explicitly approve that row;
 * otherwise the commit returns the conflicting rows and nothing is written.
 */
async function newerEditConflicts(input: {
  service: ReturnType<typeof createServiceClient>;
  userId: string;
  dbRows: ReturnType<typeof buildCommitRows>;
  batchCreatedAt: string;
  overwriteAnnotationIds: Set<string>;
}): Promise<{ rowIds: string[] }> {
  const { service, userId, dbRows, batchCreatedAt, overwriteAnnotationIds } = input;
  const notesRows = dbRows.filter((row) => row.note || row.tags.length > 0);
  if (notesRows.length === 0) return { rowIds: [] };
  const importIds = notesRows.map((row) => row.plaid_transaction_id);
  const existingTxns: Array<Record<string, unknown>> = [];
  for (const importIdChunk of chunks(importIds)) {
    const { data, error } = await service
      .from("transactions")
      .select("id, plaid_transaction_id")
      .in("plaid_transaction_id", importIdChunk)
      .eq("user_id", userId);
    if (error) throw error;
    existingTxns.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const txnIdByImportId = new Map<string, string>(
    existingTxns.map((row) => [row.plaid_transaction_id as string, row.id as string]),
  );
  const existingTxnIds = [...txnIdByImportId.values()];
  const annotations: Array<Record<string, unknown>> = [];
  for (const transactionIdChunk of chunks(existingTxnIds)) {
    const { data, error } = await service
        .from("transaction_annotations")
        .select("transaction_id, updated_at, note, tags")
        .in("transaction_id", transactionIdChunk)
        .eq("user_id", userId);
    if (error) throw error;
    annotations.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const batchTime = Date.parse(batchCreatedAt);
  const annotationByTxnId = new Map(
    annotations.map((item) => [item.transaction_id as string, item]),
  );
  const conflictRowIds = notesRows
    .filter((row) => {
      const txnId = txnIdByImportId.get(row.plaid_transaction_id);
      const annotation = txnId ? annotationByTxnId.get(txnId) : undefined;
      if (!annotation) return false;
      const updatedAt = annotation.updated_at as string | undefined;
      if (!updatedAt || Date.parse(updatedAt) <= batchTime) return false;
      // A newer timestamp alone is not a conflict: this batch's own earlier
      // commit stamps one too, so a plain retry (or a second slice of the
      // same batch) would otherwise be blocked forever. It is only a real
      // conflict when the stored annotation actually differs from what this
      // commit would write.
      return !sameAnnotation(annotation, row);
    })
    .map((row) => row.rowId);
  return {
    rowIds: conflictRowIds.filter((id) => !overwriteAnnotationIds.has(String(id))),
  };
}

/** True when the stored annotation already holds exactly this row's note/tags. */
function sameAnnotation(
  annotation: Record<string, unknown>,
  row: { note: string | null; tags: string[] },
): boolean {
  const storedNote = (annotation.note as string | null) ?? null;
  const storedTags = ((annotation.tags as string[] | null) ?? [])
    .slice()
    .sort((left, right) => left.localeCompare(right));
  const incomingTags = row.tags
    .slice()
    .sort((left, right) => left.localeCompare(right));
  return (
    storedNote === row.note &&
    storedTags.length === incomingTags.length &&
    storedTags.every((tag, index) => tag === incomingTags[index])
  );
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

  await persistSourceAccountMappings(service, sourceAccounts, mappingBySource, userId);
  await persistTransactions(service, dbRows);
  await persistTransactionAnnotations(service, dbRows, userId);

  for (const rowIdChunk of chunks(rowIds)) {
    const { error } = await service
      .from("import_review_rows")
      .update({ status: "committed" })
      .eq("user_id", userId)
      .in("id", rowIdChunk);
    if (error) throw error;
  }

  const { error: batchError } = await service
    .from("import_review_batches")
    .update({ status: "committed" })
    .eq("user_id", userId)
    .eq("id", batchId);
  if (batchError) throw batchError;
}

async function persistSourceAccountMappings(
  service: ReturnType<typeof createServiceClient>,
  sourceAccounts: string[],
  mappingBySource: Map<string, ImportTarget>,
  userId: string,
): Promise<void> {
  if (sourceAccounts.length === 0) return;

  const mappingRows = sourceAccounts.map((sourceAccount) => {
    const target = mappingBySource.get(sourceAccount)!;
    return {
      user_id: userId,
      source_account: sourceAccount,
      account_id: target.accountId ?? null,
      manual_account_id: target.manualAccountId ?? null,
    };
  });
  for (const mappingRowChunk of chunks(mappingRows)) {
    const { error } = await service
      .from("import_source_account_mappings")
      .upsert(mappingRowChunk, { onConflict: "user_id,source_account" });
    if (error) throw error;
  }
}

async function persistTransactions(
  service: ReturnType<typeof createServiceClient>,
  dbRows: ReturnType<typeof buildCommitRows>,
): Promise<void> {
  const transactionRows = dbRows.map((row) => ({
    user_id: row.user_id,
    account_id: row.account_id,
    manual_account_id: row.manual_account_id,
    plaid_transaction_id: row.plaid_transaction_id,
    amount: row.amount,
    date: row.date,
    name: row.name,
    merchant_name: row.merchant_name,
    pfc_primary: row.pfc_primary,
    pfc_detailed: row.pfc_detailed,
    pending: row.pending,
    source: row.source,
  }));
  for (let i = 0; i < transactionRows.length; i += UPSERT_CHUNK) {
    const { error } = await service
      .from("transactions")
      .upsert(transactionRows.slice(i, i + UPSERT_CHUNK), { onConflict: "plaid_transaction_id" });
    if (error) throw error;
  }
}

async function persistTransactionAnnotations(
  service: ReturnType<typeof createServiceClient>,
  dbRows: ReturnType<typeof buildCommitRows>,
  userId: string,
): Promise<void> {
  // Persist Monarch notes/tags as annotations, scoped to the owner. Only the
  // note/tags columns are written, so an existing display_category or
  // cash_flow_classification override is never touched by a re-import.
  const notesRows = dbRows.filter((row) => row.note || row.tags.length > 0);
  if (notesRows.length > 0) {
    const committedTxns: Array<Record<string, unknown>> = [];
    for (const importIdChunk of chunks(notesRows.map((row) => row.plaid_transaction_id))) {
      const { data, error } = await service
        .from("transactions")
        .select("id, plaid_transaction_id")
        .in("plaid_transaction_id", importIdChunk)
        .eq("user_id", userId);
      if (error) throw error;
      committedTxns.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
    const txnIdByImportId = new Map<string, string>(
      committedTxns.map((row) => [row.plaid_transaction_id as string, row.id as string]),
    );
    const annotationRows = notesRows
      .map((row) => ({
        user_id: userId,
        transaction_id: txnIdByImportId.get(row.plaid_transaction_id) ?? "",
        note: row.note,
        tags: row.tags,
      }))
      .filter((row) => row.transaction_id);
    if (annotationRows.length > 0) {
      for (const annotationRowChunk of chunks(annotationRows)) {
        const { error } = await service
          .from("transaction_annotations")
          .upsert(annotationRowChunk, { onConflict: "user_id,transaction_id" });
        if (error) throw error;
      }
    }
  }
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
    const overwriteAnnotationIds = new Set<string>(
      Array.isArray(body?.overwrite_annotation_row_ids)
        ? body.overwrite_annotation_row_ids.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [],
    );
    const requestedMappings = parseMappingInput(body?.account_mappings);
    if (typeof batchId !== "string" || (!accountId && !manualAccountId)) {
      return badRequest("batch_id and account_id are required");
    }

    const batch = await loadOwnedBatch(supabase, batchId, user.id);
    if (!batch) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }

    const defaultTarget: ImportTarget = typeof accountId === "string"
      ? { accountId }
      : { manualAccountId };
    const targetError = await validateDefaultTarget(supabase, defaultTarget, user.id);
    if (targetError) return targetError;

    const batchRows = await fetchBatchRows(supabase, batchId, user.id);
    const committableRows = selectCommittableRows(batchRows, approvedIds);
    // Every source account the file mentions needs a target, not just the ones
    // in this slice: occurrence numbering resolves a target for every row.
    const sourceAccounts = [...new Set(batchRows.map((row) => row.source_account).filter((value): value is string => Boolean(value)))];

    const mappingResult = await resolveMappings(
      supabase,
      user.id,
      sourceAccounts,
      requestedMappings,
      defaultTarget,
    );
    if ("error" in mappingResult) return mappingResult.error;
    const { mappingBySource } = mappingResult;

    const mappingError = await validateMappedTargets(
      supabase,
      mappingBySource,
      defaultTarget,
      user.id,
    );
    if (mappingError) return mappingError;

    const committableIds = new Set(committableRows.map((row) => row.id as string));
    const dbRows = buildCommitRows(batchRows, committableIds, mappingBySource, defaultTarget, user.id);

    const service = createServiceClient();

    // Never overwrite a newer FundFlow edit: rows whose annotations were
    // edited after the batch was created need explicit approval first.
    const { rowIds: blockedRowIds } = await newerEditConflicts({
      service,
      userId: user.id,
      dbRows,
      batchCreatedAt: batch.created_at,
      overwriteAnnotationIds,
    });
    if (blockedRowIds.length > 0) {
      return NextResponse.json(
        {
          error: "Some rows were edited in FundFlow after this import started.",
          conflicts: blockedRowIds,
        },
        { status: 409 },
      );
    }

    await persistCommit(service, {
      sourceAccounts,
      mappingBySource,
      dbRows,
      rowIds: [...committableIds],
      batchId,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, imported: dbRows.length });
  } catch (error) {
    return errorResponse("import.commit", error);
  }
}
