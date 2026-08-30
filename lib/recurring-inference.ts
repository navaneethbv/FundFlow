import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { parseFinancialScope } from "@/lib/financial-scope";
import { loadCanonicalProjection, monthWindow } from "@/lib/finance-query";
import {
  detectRecurringCandidates,
  normalizeRecurringMerchant,
  RECURRING_DETECTION_VERSION,
  type DetectedRecurringCandidate,
  type RecurringDetectionTransaction,
} from "@/lib/recurring-detection";
import { localDateKey } from "@/lib/format-date";
import { listActiveItems } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import { logError } from "@/lib/log";

export interface InferredRecurringRefreshResult {
  active: number;
  added: number;
  deactivated: number;
  deduplicated: number;
}

const ZERO_RESULT: InferredRecurringRefreshResult = {
  active: 0,
  added: 0,
  deactivated: 0,
  deduplicated: 0,
};

const RAW_METADATA_COLUMNS =
  "id,account_id,date,authorized_date,amount,merchant_name,name,pfc_primary,pfc_detailed,payment_channel,iso_currency_code,pending";

const INFERENCE_WINDOW_MONTHS = 10;

/** History coverage the detector may reach back over (its longest cadence). */
const DETECTION_HISTORY_DAYS = 310;

function inferWindowStart(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - DETECTION_HISTORY_DAYS);
  return date.toISOString().slice(0, 10);
}

interface RawMetadataRow {
  id: string;
  account_id: string | null;
  date: string;
  authorized_date: string | null;
  amount: number;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  payment_channel: string | null;
  iso_currency_code: string | null;
  pending: boolean | null;
}

interface PlaidStreamRow {
  id: string;
  stream_type: "inflow" | "outflow";
  account_id: string | null;
  frequency: string | null;
  merchant_name: string | null;
  description: string | null;
  identity_key: string | null;
  is_active: boolean | null;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | string | null;
}

interface InferredStreamRow {
  id: string;
  identity_key: string | null;
  is_active: boolean | null;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | string | null;
}

interface JoinRow {
  recurring_stream_id: string;
  transaction_id: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function loadItemAccountIds(
  supabase: ReturnType<typeof createServiceClient>,
  item: PlaidItemRow,
): Promise<string[]> {
  // Service client bypasses RLS, so both filters are load-bearing.
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id);
  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

/**
 * Canonical, detector-ready transactions for one item: the canonical
 * projection (which already nets refunds, excludes duplicates, and rules out
 * transfers) intersected with the item's accounts, joined back to raw
 * metadata for category, channel, and currency, with split parts collapsed
 * to one occurrence per source transaction.
 */
async function loadDetectionTransactions(
  supabase: ReturnType<typeof createServiceClient>,
  item: PlaidItemRow,
  accountIds: string[],
  today: string,
): Promise<RecurringDetectionTransaction[]> {
  if (accountIds.length === 0) return [];
  const accountSet = new Set(accountIds);
  const window = monthWindow(today.slice(0, 7), INFERENCE_WINDOW_MONTHS);
  const projection = await loadCanonicalProjection(supabase, {
    scope: parseFinancialScope({ raw: "mine", ownerUserId: item.user_id, visibleHouseholdIds: [] }),
    window: { start: inferWindowStart(today), endExclusive: window.endExclusive },
    excludePending: true,
  });

  const rawRows: RawMetadataRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(RAW_METADATA_COLUMNS)
      .eq("user_id", item.user_id)
      .eq("pending", false)
      .gte("date", inferWindowStart(today))
      .lt("date", window.endExclusive)
      .in("account_id", accountIds)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as RawMetadataRow[];
    rawRows.push(...page);
    if (page.length < 1_000) break;
  }
  const rawBySourceId = new Map(rawRows.map((row) => [row.id, row]));

  // Collapse split parts back to one source transaction occurrence.
  const amountsBySourceId = new Map<string, { total: number; transferOnly: boolean }>();
  for (const row of projection.transactions) {
    if (!row.accountId || !accountSet.has(row.accountId)) continue;
    if (row.manualAccountId) continue;
    const entry = amountsBySourceId.get(row.sourceTransactionId) ?? {
      total: 0,
      transferOnly: true,
    };
    entry.total += row.signedAmount;
    if (row.flow !== "transfer") entry.transferOnly = false;
    amountsBySourceId.set(row.sourceTransactionId, entry);
  }

  const detectionTransactions: RecurringDetectionTransaction[] = [];
  for (const [sourceId, entry] of amountsBySourceId) {
    const raw = rawBySourceId.get(sourceId);
    if (!raw) continue;
    if (entry.transferOnly || entry.total === 0) continue;
    detectionTransactions.push({
      id: sourceId,
      userId: item.user_id,
      plaidItemId: item.id,
      accountId: raw.account_id ?? "",
      postedDate: raw.date,
      authorizedDate: raw.authorized_date ?? null,
      amount: entry.total,
      flow: entry.total > 0 ? "expense" : "income",
      merchant: raw.merchant_name ?? raw.name ?? "",
      rawName: raw.name,
      category: raw.pfc_primary,
      detailedCategory: raw.pfc_detailed,
      paymentChannel: raw.payment_channel,
      currency: raw.iso_currency_code,
    });
  }
  return detectionTransactions;
}

async function loadPlaidStreamRows(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  itemId: string,
): Promise<PlaidStreamRow[]> {
  const { data, error } = await supabase
    .from("recurring_streams")
    .select(
      "id,stream_type,account_id,frequency,merchant_name,description,identity_key,is_active,reviewed_at,dismissed_at,user_amount",
    )
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId)
    .eq("source", "plaid")
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as unknown as PlaidStreamRow[];
}

async function loadInferredStreamRows(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  itemId: string,
): Promise<InferredStreamRow[]> {
  const { data, error } = await supabase
    .from("recurring_streams")
    .select("id,identity_key,is_active,reviewed_at,dismissed_at,user_amount")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId)
    .eq("source", "inferred");
  if (error) throw error;
  return (data ?? []) as unknown as InferredStreamRow[];
}

/** Local transaction ids joined to each stream row, keyed by stream row id. */
async function loadStreamJoinIds(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  streamRowIds: string[],
): Promise<Map<string, Set<string>>> {
  const joinIds = new Map<string, Set<string>>();
  for (let i = 0; i < streamRowIds.length; i += 500) {
    const chunk = streamRowIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("recurring_stream_transactions")
      .select("recurring_stream_id,transaction_id")
      .eq("user_id", userId)
      .in("recurring_stream_id", chunk);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as JoinRow[]) {
      const set = joinIds.get(row.recurring_stream_id) ?? new Set<string>();
      set.add(row.transaction_id);
      joinIds.set(row.recurring_stream_id, set);
    }
  }
  return joinIds;
}

function cadenceCompatible(candidate: DetectedRecurringCandidate, plaidRow: PlaidStreamRow): boolean {
  return candidate.frequency === plaidRow.frequency;
}

/**
 * Plaid-first deduplication: transaction-id overlap wins, then account,
 * direction, normalized merchant identity, and a compatible cadence.
 */
function findMatchingPlaidRow(
  candidate: DetectedRecurringCandidate,
  plaidRows: readonly PlaidStreamRow[],
  plaidJoinIds: ReadonlyMap<string, Set<string>>,
): PlaidStreamRow | null {
  const candidateJoinIds = new Set(candidate.transactionIds);
  for (const plaidRow of plaidRows) {
    const joined = plaidJoinIds.get(plaidRow.id);
    if (joined && [...joined].some((id) => candidateJoinIds.has(id))) return plaidRow;
  }
  const candidateMerchant = normalizeRecurringMerchant(candidate.merchantName);
  for (const plaidRow of plaidRows) {
    if (plaidRow.account_id !== candidate.accountId) continue;
    if ((plaidRow.stream_type ?? "outflow") !== candidate.streamType) continue;
    if (!cadenceCompatible(candidate, plaidRow)) continue;
    if (plaidRow.identity_key && plaidRow.identity_key === candidate.identityKey) {
      return plaidRow;
    }
    const plaidMerchant = normalizeRecurringMerchant(
      plaidRow.merchant_name ?? plaidRow.description ?? "",
    );
    if (candidateMerchant && plaidMerchant === candidateMerchant) return plaidRow;
  }
  return null;
}

function candidateRowPayload(
  item: PlaidItemRow,
  candidate: DetectedRecurringCandidate,
): Record<string, unknown> {
  return {
    user_id: item.user_id,
    plaid_item_id: item.id,
    stream_id: candidate.streamId,
    stream_type: candidate.streamType,
    description: candidate.description,
    merchant_name: candidate.merchantName,
    average_amount: candidate.averageAmount,
    last_amount: candidate.lastAmount,
    frequency: candidate.frequency,
    status: "MATURE",
    category: candidate.category,
    is_active: true,
    account_id: candidate.accountId,
    first_date: candidate.firstDate,
    last_date: candidate.lastDate,
    predicted_next_date: candidate.predictedNextDate,
    source: "inferred",
    identity_key: candidate.identityKey,
    detection_version: RECURRING_DETECTION_VERSION,
    detection_evidence: candidate.evidence,
  };
}

/**
 * Upserts one inferred candidate by user + identity. PostgREST cannot name a
 * partial-index predicate in `onConflict`, so the flow is update-by-id when
 * the row exists, insert when it does not, and reload-then-update when a
 * concurrent writer won the partial unique index race (23505).
 */
async function upsertInferredRow(
  supabase: ReturnType<typeof createServiceClient>,
  item: PlaidItemRow,
  candidate: DetectedRecurringCandidate,
): Promise<string> {
  const payload = candidateRowPayload(item, candidate);
  const { data: existing, error: existingError } = await supabase
    .from("recurring_streams")
    .select("id")
    .eq("user_id", item.user_id)
    .eq("identity_key", candidate.identityKey)
    .eq("source", "inferred")
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { error } = await supabase
      .from("recurring_streams")
      .update(payload)
      .eq("id", existing.id as string)
      .eq("user_id", item.user_id)
      .eq("plaid_item_id", item.id)
      .eq("source", "inferred");
    if (error) throw error;
    return existing.id as string;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("recurring_streams")
    .insert(payload)
    .select("id");
  if (!insertError && inserted && inserted.length > 0) {
    return inserted[0]!.id as string;
  }
  if (!insertError || !isUniqueViolation(insertError)) {
    throw insertError ?? new Error("recurring_inference_insert_failed");
  }
  const { data: winner, error: winnerError } = await supabase
    .from("recurring_streams")
    .select("id")
    .eq("user_id", item.user_id)
    .eq("identity_key", candidate.identityKey)
    .eq("source", "inferred")
    .maybeSingle();
  if (winnerError) throw winnerError;
  if (!winner) throw insertError;
  const { error: updateError } = await supabase
    .from("recurring_streams")
    .update(payload)
    .eq("id", winner.id as string)
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .eq("source", "inferred");
  if (updateError) throw updateError;
  return winner.id as string;
}

/**
 * Moves compatible user state (review, dismissal, amount override) from the
 * inferred row into null Plaid fields, then deactivates the inferred row.
 */
async function transferStateToPlaidRow(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  plaidRow: PlaidStreamRow,
  inferredRow: InferredStreamRow,
): Promise<void> {
  const transfer: Record<string, unknown> = {};
  if (inferredRow.reviewed_at && !plaidRow.reviewed_at) {
    transfer.reviewed_at = inferredRow.reviewed_at;
  }
  if (inferredRow.dismissed_at && !plaidRow.dismissed_at) {
    transfer.dismissed_at = inferredRow.dismissed_at;
  }
  if (inferredRow.user_amount !== null && plaidRow.user_amount === null) {
    transfer.user_amount = Number(inferredRow.user_amount);
  }
  if (Object.keys(transfer).length > 0) {
    const { error } = await supabase
      .from("recurring_streams")
      .update(transfer)
      .eq("id", plaidRow.id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  const { error: deactivateError } = await supabase
    .from("recurring_streams")
    .update({ is_active: false })
    .eq("id", inferredRow.id)
    .eq("user_id", userId)
    .eq("source", "inferred");
  if (deactivateError) throw deactivateError;
}

async function replaceInferredJoins(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  streamRowId: string,
  transactionIds: readonly string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("recurring_stream_transactions")
    .delete()
    .eq("recurring_stream_id", streamRowId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  if (transactionIds.length === 0) return;
  const { error: insertError } = await supabase
    .from("recurring_stream_transactions")
    .insert(
      transactionIds.map((transactionId) => ({
        user_id: userId,
        recurring_stream_id: streamRowId,
        transaction_id: transactionId,
      })),
    );
  if (insertError) throw insertError;
}

/**
 * Detects locally recurring patterns for one item's canonical transactions
 * and reconciles them into `recurring_streams` as inferred rows. Plaid wins
 * every deduplication conflict; a failed pass leaves stored rows unchanged
 * because mark-and-sweep only runs after every candidate and join succeeds.
 */
export async function refreshInferredRecurringForItem(
  item: PlaidItemRow,
  options?: { today?: string },
): Promise<InferredRecurringRefreshResult> {
  const supabase = createServiceClient();
  const today = options?.today ?? localDateKey();

  const accountIds = await loadItemAccountIds(supabase, item);
  if (accountIds.length === 0) return ZERO_RESULT;

  const detectionTransactions = await loadDetectionTransactions(
    supabase,
    item,
    accountIds,
    today,
  );
  const candidates = detectRecurringCandidates(detectionTransactions, today);

  const plaidRows = await loadPlaidStreamRows(supabase, item.user_id, item.id);
  const plaidJoinIds = await loadStreamJoinIds(
    supabase,
    item.user_id,
    plaidRows.map((row) => row.id),
  );
  const inferredRows = await loadInferredStreamRows(supabase, item.user_id, item.id);
  const inferredRowByIdentity = new Map<string, InferredStreamRow>();
  for (const row of inferredRows) {
    if (row.identity_key) inferredRowByIdentity.set(row.identity_key, row);
  }

  let added = 0;
  let deduplicated = 0;
  const persistedIdentities = new Set<string>();
  const persistedRowIds: string[] = [];

  for (const candidate of candidates) {
    const matchingPlaidRow = findMatchingPlaidRow(candidate, plaidRows, plaidJoinIds);
    const existingInferredRow = inferredRowByIdentity.get(candidate.identityKey);
    if (matchingPlaidRow) {
      deduplicated += 1;
      if (existingInferredRow) {
        await transferStateToPlaidRow(supabase, item.user_id, matchingPlaidRow, existingInferredRow);
      }
      continue;
    }

    const rowId = await upsertInferredRow(supabase, item, candidate);
    await replaceInferredJoins(supabase, item.user_id, rowId, candidate.transactionIds);
    persistedIdentities.add(candidate.identityKey);
    persistedRowIds.push(rowId);
    if (!existingInferredRow || !existingInferredRow.is_active) added += 1;
  }

  // Mark-and-sweep: only after every candidate and join succeeded. Active
  // inferred rows for this item that this pass did not re-materialize are
  // stale (including a pass with zero candidates, which is a complete,
  // successful detection result over the current ledger).
  const staleIds = inferredRows
    .filter((row) => row.is_active && (!row.identity_key || !persistedIdentities.has(row.identity_key)))
    .map((row) => row.id);
  let deactivated = 0;
  for (let i = 0; i < staleIds.length; i += 500) {
    const chunk = staleIds.slice(i, i + 500);
    const { error } = await supabase
      .from("recurring_streams")
      .update({ is_active: false })
      .eq("user_id", item.user_id)
      .eq("plaid_item_id", item.id)
      .eq("source", "inferred")
      .in("id", chunk);
    if (error) throw error;
    deactivated += chunk.length;
  }

  return {
    active: persistedRowIds.length,
    added,
    deactivated,
    deduplicated,
  };
}

/** Runs item-scoped inference for every active item of a user. */
export async function refreshInferredRecurringForUser(
  userId: string,
  options?: { today?: string },
): Promise<InferredRecurringRefreshResult> {
  const items = await listActiveItems(userId);
  const totals: InferredRecurringRefreshResult = { ...ZERO_RESULT };
  for (const item of items) {
    try {
      const result = await refreshInferredRecurringForItem(item, options);
      totals.active += result.active;
      totals.added += result.added;
      totals.deactivated += result.deactivated;
      totals.deduplicated += result.deduplicated;
    } catch (error) {
      logError("recurring.inference.item", error);
    }
  }
  return totals;
}
