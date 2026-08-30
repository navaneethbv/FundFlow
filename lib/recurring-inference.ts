import "server-only";

import { loadCanonicalProjection } from "@/lib/finance-query";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import {
  detectRecurringCandidates,
  normalizeRecurringMerchant,
  type DetectedRecurringCandidate,
  RECURRING_DETECTION_VERSION,
} from "@/lib/recurring-detection";
import { createServiceClient } from "@/lib/supabase/service";
import { listActiveItems } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";

export interface InferredRecurringRefreshResult {
  active: number;
  added: number;
  deactivated: number;
  deduplicated: number;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

interface AccountRow {
  id: string;
}

interface TransactionMetadataRow {
  id: string;
  account_id: string;
  date: string;
  authorized_date: string | null;
  amount: number | string;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  payment_channel: string | null;
  iso_currency_code: string | null;
  pending: boolean;
}

interface RecurringStreamRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  stream_id: string;
  stream_type: "inflow" | "outflow" | string | null;
  description: string | null;
  merchant_name: string | null;
  average_amount: number | string | null;
  last_amount: number | string | null;
  frequency: string | null;
  status: string | null;
  category: string | null;
  is_active: boolean;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | string | null;
  account_id: string | null;
  first_date: string | null;
  last_date: string | null;
  predicted_next_date: string | null;
  source?: "plaid" | "inferred" | null;
  identity_key?: string | null;
}

interface StreamTransactionRow {
  recurring_stream_id: string;
  transaction_id: string;
}

const STREAM_COLUMNS =
  "id,user_id,plaid_item_id,stream_id,stream_type,description,merchant_name,average_amount,last_amount,frequency,status,category,is_active,reviewed_at,dismissed_at,user_amount,account_id,first_date,last_date,predicted_next_date,source,identity_key";
const RAW_METADATA_PAGE_SIZE = 1000;

function tenMonthWindow(today: string): { start: string; endExclusive: string } {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const endTotal = year! * 12 + month!;
  const startTotal = endTotal - 10;
  const startYear = Math.floor(startTotal / 12);
  const startMonth = (startTotal % 12) + 1;
  const endYear = Math.floor(endTotal / 12);
  const endMonth = (endTotal % 12) + 1;
  return {
    start: `${startYear}-${String(startMonth).padStart(2, "0")}-01`,
    endExclusive: `${endYear}-${String(endMonth).padStart(2, "0")}-01`,
  };
}

function asRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return data ? [data as T] : [];
  return data as T[];
}

function throwQueryError(error: unknown): void {
  if (error) throw error;
}

async function loadItemAccounts(
  supabase: ServiceClient,
  item: PlaidItemRow,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .order("id", { ascending: true });
  throwQueryError(error);
  return asRows<AccountRow>(data)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function loadRawMetadata(
  supabase: ServiceClient,
  item: PlaidItemRow,
  accountIds: readonly string[],
  window: { start: string; endExclusive: string },
): Promise<TransactionMetadataRow[]> {
  if (accountIds.length === 0) return [];
  const rows: TransactionMetadataRow[] = [];
  for (let offset = 0; ; offset += RAW_METADATA_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id,account_id,date,authorized_date,amount,merchant_name,name,pfc_primary,pfc_detailed,payment_channel,iso_currency_code,pending")
      .eq("user_id", item.user_id)
      .in("account_id", [...accountIds])
      .eq("pending", false)
      .gte("date", window.start)
      .lt("date", window.endExclusive)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + RAW_METADATA_PAGE_SIZE - 1);
    throwQueryError(error);
    const page = asRows<TransactionMetadataRow>(data);
    rows.push(...page);
    if (page.length < RAW_METADATA_PAGE_SIZE) return rows;
  }
}

async function loadStreams(
  supabase: ServiceClient,
  item: PlaidItemRow,
  source: "plaid" | "inferred",
): Promise<RecurringStreamRow[]> {
  const { data, error } = await supabase
    .from("recurring_streams")
    .select(STREAM_COLUMNS)
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .eq("source", source)
    .order("id", { ascending: true });
  throwQueryError(error);
  return asRows<RecurringStreamRow>(data);
}

async function loadStreamTransactions(
  supabase: ServiceClient,
  userId: string,
  streamIds: readonly string[],
): Promise<StreamTransactionRow[]> {
  if (streamIds.length === 0) return [];
  const { data, error } = await supabase
    .from("recurring_stream_transactions")
    .select("recurring_stream_id,transaction_id")
    .eq("user_id", userId)
    .in("recurring_stream_id", [...streamIds])
    .order("recurring_stream_id", { ascending: true })
    .order("transaction_id", { ascending: true });
  throwQueryError(error);
  return asRows<StreamTransactionRow>(data);
}

function canonicalBySourceId(
  transactions: readonly CanonicalFinanceTransaction[],
): Map<string, CanonicalFinanceTransaction> {
  const result = new Map<string, CanonicalFinanceTransaction>();
  for (const transaction of transactions) {
    if (transaction.flow === "transfer" || transaction.pending || result.has(transaction.sourceTransactionId)) continue;
    result.set(transaction.sourceTransactionId, transaction);
  }
  return result;
}

function detectionInput(
  metadata: readonly TransactionMetadataRow[],
  projection: readonly CanonicalFinanceTransaction[],
  item: PlaidItemRow,
  accountIds: ReadonlySet<string>,
): Parameters<typeof detectRecurringCandidates>[0] {
  const bySourceId = canonicalBySourceId(projection);
  return metadata.flatMap((row) => {
    if (row.pending || !accountIds.has(row.account_id)) return [];
    const canonical = bySourceId.get(row.id);
    if (!canonical || canonical.accountId !== row.account_id || canonical.flow === "transfer") return [];
    const amount = Math.abs(Number(row.amount));
    if (!Number.isFinite(amount) || amount <= 0) return [];
    return [{
      id: row.id,
      userId: item.user_id,
      plaidItemId: item.id,
      accountId: row.account_id,
      postedDate: row.date,
      authorizedDate: row.authorized_date,
      amount,
      flow: canonical.flow === "income" ? "income" as const : "expense" as const,
      merchant: canonical.merchant || row.merchant_name || row.name || "",
      rawName: row.name,
      category: canonical.groupKey || row.pfc_primary,
      detailedCategory: canonical.categoryKey || row.pfc_detailed,
      paymentChannel: row.payment_channel,
      currency: row.iso_currency_code,
    }];
  });
}

function cadenceCompatible(plaidFrequency: string | null, inferredFrequency: string): boolean {
  return plaidFrequency === inferredFrequency;
}

function plaidMerchant(stream: RecurringStreamRow): string {
  return stream.merchant_name?.trim() || stream.description?.trim() || "";
}

function dedupMatches(
  candidate: DetectedRecurringCandidate,
  plaid: RecurringStreamRow,
  plaidTransactionIds: ReadonlySet<string>,
): boolean {
  if (candidate.transactionIds.some((id) => plaidTransactionIds.has(id))) return true;
  if (plaid.account_id !== candidate.accountId || plaid.stream_type !== candidate.streamType) return false;
  if (!cadenceCompatible(plaid.frequency, candidate.frequency)) return false;
  return Boolean(plaid.identity_key && plaid.identity_key === candidate.identityKey)
    || normalizeRecurringMerchant(plaidMerchant(plaid)) === normalizeRecurringMerchant(candidate.merchantName);
}

function inferredPayload(
  item: PlaidItemRow,
  candidate: DetectedRecurringCandidate,
) {
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
    source: "inferred" as const,
    identity_key: candidate.identityKey,
    detection_version: RECURRING_DETECTION_VERSION,
    detection_evidence: candidate.evidence,
  };
}

async function findExistingInferred(
  supabase: ServiceClient,
  item: PlaidItemRow,
  identityKey: string,
): Promise<RecurringStreamRow | null> {
  const { data, error } = await supabase
    .from("recurring_streams")
    .select(STREAM_COLUMNS)
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .eq("source", "inferred")
    .eq("identity_key", identityKey)
    .maybeSingle();
  throwQueryError(error);
  return asRows<RecurringStreamRow>(data)[0] ?? null;
}

async function updateInferred(
  supabase: ServiceClient,
  item: PlaidItemRow,
  existing: RecurringStreamRow,
  candidate: DetectedRecurringCandidate,
): Promise<string> {
  const { error } = await supabase
    .from("recurring_streams")
    .update(inferredPayload(item, candidate))
    .eq("id", existing.id)
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .eq("source", "inferred");
  throwQueryError(error);
  return existing.id;
}

async function insertInferred(
  supabase: ServiceClient,
  item: PlaidItemRow,
  candidate: DetectedRecurringCandidate,
): Promise<string> {
  const result = await supabase
    .from("recurring_streams")
    .insert(inferredPayload(item, candidate))
    .select("id,stream_id")
    .maybeSingle();
  if (!result.error) {
    const id = asRows<{ id: string }>(result.data)[0]?.id;
    if (id) return id;
  } else if (result.error.code !== "23505") {
    throw result.error;
  }

  const winner = await findExistingInferred(supabase, item, candidate.identityKey);
  if (!winner) throw result.error ?? new Error("inferred_recurring_insert_conflict_without_winner");
  await updateInferred(supabase, item, winner, candidate);
  return winner.id;
}

async function replaceJoins(
  supabase: ServiceClient,
  userId: string,
  streamId: string,
  transactionIds: readonly string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("recurring_stream_transactions")
    .delete()
    .eq("recurring_stream_id", streamId)
    .eq("user_id", userId);
  throwQueryError(deleteError);
  if (transactionIds.length === 0) return;
  const { error: insertError } = await supabase.from("recurring_stream_transactions").insert(
    transactionIds.map((transactionId) => ({
      user_id: userId,
      recurring_stream_id: streamId,
      transaction_id: transactionId,
    })),
  );
  throwQueryError(insertError);
}

async function transferStateAndDeactivate(
  supabase: ServiceClient,
  item: PlaidItemRow,
  inferred: RecurringStreamRow,
  plaid: RecurringStreamRow,
): Promise<void> {
  const state: Record<string, unknown> = {};
  if ((plaid.reviewed_at === null || plaid.reviewed_at === undefined) && inferred.reviewed_at !== null && inferred.reviewed_at !== undefined) state.reviewed_at = inferred.reviewed_at;
  if ((plaid.dismissed_at === null || plaid.dismissed_at === undefined) && inferred.dismissed_at !== null && inferred.dismissed_at !== undefined) state.dismissed_at = inferred.dismissed_at;
  if ((plaid.user_amount === null || plaid.user_amount === undefined) && inferred.user_amount !== null && inferred.user_amount !== undefined) state.user_amount = inferred.user_amount;
  if (Object.keys(state).length > 0) {
    const { error } = await supabase
      .from("recurring_streams")
      .update(state)
      .eq("id", plaid.id)
      .eq("user_id", item.user_id)
      .eq("plaid_item_id", item.id)
      .eq("source", "plaid");
    throwQueryError(error);
  }
  const { error } = await supabase
    .from("recurring_streams")
    .update({ is_active: false })
    .eq("id", inferred.id)
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id)
    .eq("source", "inferred");
  throwQueryError(error);
}

async function deactivateStale(
  supabase: ServiceClient,
  item: PlaidItemRow,
  rows: readonly RecurringStreamRow[],
  activeStreamIds: ReadonlySet<string>,
  excludedStreamIds: ReadonlySet<string>,
): Promise<number> {
  const stale = rows.filter((row) => row.is_active && !activeStreamIds.has(row.stream_id) && !excludedStreamIds.has(row.stream_id));
  for (const row of stale) {
    const { error } = await supabase
      .from("recurring_streams")
      .update({ is_active: false })
      .eq("id", row.id)
      .eq("user_id", item.user_id)
      .eq("plaid_item_id", item.id)
      .eq("source", "inferred");
    throwQueryError(error);
  }
  return stale.length;
}

export async function refreshInferredRecurringForItem(
  item: PlaidItemRow,
  options: { today?: string } = {},
): Promise<InferredRecurringRefreshResult> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) throw new Error("invalid_recurring_inference_today");
  const supabase = createServiceClient();
  const window = tenMonthWindow(today);
  const accountIds = await loadItemAccounts(supabase, item);
  const projection = await loadCanonicalProjection(supabase, {
    scope: { kind: "mine", ownerUserId: item.user_id },
    window,
    excludePending: true,
  });
  const metadata = await loadRawMetadata(supabase, item, accountIds, window);
  const candidates = detectRecurringCandidates(
    detectionInput(metadata, projection.transactions, item, new Set(accountIds)),
    today,
  );

  // All source rows, joins, and identity matches are read before any mutation.
  const [plaidRows, inferredRows] = await Promise.all([
    loadStreams(supabase, item, "plaid"),
    loadStreams(supabase, item, "inferred"),
  ]);
  const plaidJoins = await loadStreamTransactions(
    supabase,
    item.user_id,
    plaidRows.map((row) => row.id),
  );
  const plaidIdsByStream = new Map<string, Set<string>>();
  for (const join of plaidJoins) {
    const ids = plaidIdsByStream.get(join.recurring_stream_id) ?? new Set<string>();
    ids.add(join.transaction_id);
    plaidIdsByStream.set(join.recurring_stream_id, ids);
  }
  const existingByCandidate = new Map<string, RecurringStreamRow | null>();
  for (const candidate of candidates) {
    existingByCandidate.set(candidate.identityKey, await findExistingInferred(supabase, item, candidate.identityKey));
  }

  const decisions = candidates.map((candidate) => {
    const plaidMatch = plaidRows.find((row) => dedupMatches(
      candidate,
      row,
      plaidIdsByStream.get(row.id) ?? new Set<string>(),
    ));
    return { candidate, plaidMatch, existing: existingByCandidate.get(candidate.identityKey) ?? null };
  });

  let added = 0;
  let deduplicated = 0;
  let deduplicatedActive = 0;
  const activeStreamIds = new Set<string>();
  const deduplicatedRows = new Set<string>();
  for (const decision of decisions) {
    if (decision.plaidMatch) {
      deduplicated += 1;
      if (decision.existing) {
        if (decision.existing.is_active) deduplicatedActive += 1;
        await transferStateAndDeactivate(supabase, item, decision.existing, decision.plaidMatch);
        deduplicatedRows.add(decision.existing.stream_id);
      }
      continue;
    }
    const streamRowId = decision.existing
      ? await updateInferred(supabase, item, decision.existing, decision.candidate)
      : await insertInferred(supabase, item, decision.candidate);
    if (!decision.existing) added += 1;
    activeStreamIds.add(decision.candidate.streamId);
    await replaceJoins(supabase, item.user_id, streamRowId, decision.candidate.transactionIds);
  }

  const deactivated = (await deactivateStale(supabase, item, inferredRows, activeStreamIds, deduplicatedRows))
    + deduplicatedActive;
  return {
    active: activeStreamIds.size,
    added,
    deactivated,
    deduplicated,
  };
}

export async function refreshInferredRecurringForUser(
  userId: string,
  options: { today?: string } = {},
): Promise<InferredRecurringRefreshResult> {
  const items = await listActiveItems(userId);
  const result: InferredRecurringRefreshResult = { active: 0, added: 0, deactivated: 0, deduplicated: 0 };
  for (const item of items) {
    const itemResult = await refreshInferredRecurringForItem(item, options);
    result.active += itemResult.active;
    result.added += itemResult.added;
    result.deactivated += itemResult.deactivated;
    result.deduplicated += itemResult.deduplicated;
  }
  return result;
}
