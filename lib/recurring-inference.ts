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

function identityMatches(
  candidate: DetectedRecurringCandidate,
  plaid: RecurringStreamRow,
): boolean {
  if (plaid.account_id !== candidate.accountId || plaid.stream_type !== candidate.streamType) return false;
  if (!cadenceCompatible(plaid.frequency, candidate.frequency)) return false;
  return Boolean(plaid.identity_key && plaid.identity_key === candidate.identityKey)
    || normalizeRecurringMerchant(plaidMerchant(plaid)) === normalizeRecurringMerchant(candidate.merchantName);
}

function findPlaidMatch(
  candidate: DetectedRecurringCandidate,
  plaidRows: readonly RecurringStreamRow[],
  plaidIdsByStream: ReadonlyMap<string, ReadonlySet<string>>,
): RecurringStreamRow | undefined {
  const overlap = plaidRows.find((row) =>
    candidate.transactionIds.some((id) => plaidIdsByStream.get(row.id)?.has(id)),
  );
  return overlap ?? plaidRows.find((row) => identityMatches(candidate, row));
}

interface ReconciliationPayload {
  candidates: Array<Record<string, unknown>>;
  deduplications: Array<{ plaid_id: string; inferred_id: string }>;
}

function toPayload(
  decisions: ReadonlyArray<{
    candidate: DetectedRecurringCandidate;
    plaidMatch: RecurringStreamRow | undefined;
    existing: RecurringStreamRow | null;
  }>,
): ReconciliationPayload {
  return {
    candidates: decisions
      .filter((decision) => !decision.plaidMatch)
      .map(({ candidate }) => ({
        stream_id: candidate.streamId,
        identity_key: candidate.identityKey,
        account_id: candidate.accountId,
        stream_type: candidate.streamType,
        description: candidate.description,
        merchant_name: candidate.merchantName,
        expected_amount: candidate.expectedAmount,
        last_amount: candidate.lastAmount,
        frequency: candidate.frequency,
        category: candidate.category,
        first_date: candidate.firstDate,
        last_date: candidate.lastDate,
        predicted_next_date: candidate.predictedNextDate,
        detection_version: RECURRING_DETECTION_VERSION,
        detection_evidence: candidate.evidence,
        transaction_ids: candidate.transactionIds,
      })),
    deduplications: decisions
      .filter((decision) => Boolean(decision.plaidMatch))
      .map((decision) => ({
        plaid_id: decision.plaidMatch!.id,
        inferred_id: decision.existing?.id ?? "",
      })),
  };
}

function rpcResult(data: unknown): InferredRecurringRefreshResult {
  if (!data || typeof data !== "object") throw new Error("recurring_reconciliation_result_invalid");
  const result = data as Record<string, unknown>;
  const values = [result.active, result.added, result.deactivated, result.deduplicated];
  if (!values.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0)) {
    throw new Error("recurring_reconciliation_result_invalid");
  }
  return {
    active: result.active as number,
    added: result.added as number,
    deactivated: result.deactivated as number,
    deduplicated: result.deduplicated as number,
  };
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
  if (projection.truncated) throw new Error("recurring_projection_truncated");
  const metadata = await loadRawMetadata(supabase, item, accountIds, window);
  const candidates = detectRecurringCandidates(
    detectionInput(metadata, projection.transactions, item, new Set(accountIds)),
    today,
  );

  // All source rows, joins, and identity matches are read before any mutation.
  const plaidRows = await loadStreams(supabase, item, "plaid");
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
    const plaidMatch = findPlaidMatch(candidate, plaidRows, plaidIdsByStream);
    return { candidate, plaidMatch, existing: existingByCandidate.get(candidate.identityKey) ?? null };
  });
  const payload = toPayload(decisions);
  const { data, error } = await supabase.rpc("reconcile_inferred_recurring", {
    p_user_id: item.user_id,
    p_item_id: item.id,
    p_payload: payload,
  });
  throwQueryError(error);
  return rpcResult(data);
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
