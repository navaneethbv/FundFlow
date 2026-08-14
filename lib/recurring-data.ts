import type { SupabaseClient } from "@supabase/supabase-js";
import { groupKeyFor } from "@/lib/accounts-page";
import {
  parseFinancialScope,
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";
import {
  countUnreviewedStreams,
  expandStreamsForMonth,
  type ManualRecurringFrequency,
  type ManualRecurringItemInput,
  type RecurringMonth,
  type RecurringStreamInput,
  type RecurringStreamStatus,
} from "@/lib/recurring-page";

const DEPENDENCY_LIMIT = 5_000;

type RecurringStreamRawRow = {
  id: string;
  user_id: string;
  merchant_name: string | null;
  description: string | null;
  stream_type: "inflow" | "outflow";
  status: RecurringStreamStatus | null;
  is_active: boolean;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | string | null;
  average_amount: number | string | null;
  last_amount: number | string | null;
  frequency: string | null;
  first_date: string | null;
  last_date: string | null;
  predicted_next_date: string | null;
  account_id: string | null;
  category: string | null;
};

export interface RecurringStreamRow {
  id: string;
  merchantName: string | null;
  description: string | null;
  streamType: "inflow" | "outflow";
  status: RecurringStreamStatus;
  isActive: boolean;
  reviewedAt: string | null;
  dismissedAt: string | null;
  userAmount: number | null;
  averageAmount: number | null;
  accountName: string | null;
  /**
   * Whether this stream belongs to the actual authenticated caller (not just
   * whichever `user_id` scope's queries used). In household scope, RLS
   * surfaces every household member's streams, but only the owner's own rows
   * are actionable through `PATCH /api/recurring` (that route always scopes
   * to the real caller). Non-owned rows must render read-only in the UI.
   */
  isOwn: boolean;
}

export interface ManualRecurringItemRow {
  id: string;
  name: string;
  amount: number;
  frequency: ManualRecurringFrequency;
  nextDate: string;
  itemType: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

interface ManualRecurringRawRow {
  id: string;
  name: string;
  amount: number | string;
  frequency: string;
  next_date: string;
  item_type: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

interface AccountRow {
  id: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  iso_currency_code: string | null;
}

interface JoinRow {
  recurring_stream_id: string;
  transaction_id: string;
}

interface TransactionDateRow {
  id: string;
  date: string;
}

interface SyncRow {
  updated_at: string;
}

export interface RecurringLoadResult {
  view: RecurringMonth;
  scope: FinancialScope;
  visibleHouseholdIds: string[];
  allStreams: RecurringStreamRow[];
  manualItems: ManualRecurringItemRow[];
  stale: boolean;
  /**
   * A single dominant currency for the scoped accounts, used to label
   * amounts throughout the Recurring page. This is a deliberate
   * simplification, not full multi-currency partitioning like Cash
   * Flow/Budget: Recurring streams are shown as one combined list rather
   * than split per currency, so we pick the most common ISO currency code
   * among the user's accounts (ties broken by first-seen order) and label
   * everything with it. Falls back to "USD" when no account resolves a
   * currency code.
   */
  currency: string;
}

function dominantCurrency(accounts: AccountRow[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const account of accounts) {
    const code = (account.iso_currency_code ?? "").trim().toUpperCase();
    if (!code) continue;
    if (!counts.has(code)) order.push(code);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (order.length === 0) return "USD";
  let best = order[0]!;
  let bestCount = counts.get(best) ?? 0;
  for (const code of order) {
    const count = counts.get(code) ?? 0;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function assertRecurringQuery(table: string, result: { error: { code?: string } | null }): void {
  if (!result.error) return;
  const code = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`recurring_query_failed:${table}${code}`);
}

function isStale(lastSuccessfulSyncAt: string | null, now: Date): boolean {
  if (!lastSuccessfulSyncAt) return true;
  const parsed = Date.parse(lastSuccessfulSyncAt);
  return !Number.isFinite(parsed) || now.getTime() - parsed > 48 * 60 * 60 * 1000;
}

const KNOWN_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "ANNUALLY"]);
const KNOWN_STATUSES = new Set(["MATURE", "EARLY_DETECTION", "TOMBSTONED"]);

async function loadJoinRows(
  supabase: SupabaseClient,
  streamIds: string[],
  userId: string | undefined,
): Promise<JoinRow[]> {
  const rows: JoinRow[] = [];
  for (let i = 0; i < streamIds.length; i += 500) {
    const chunk = streamIds.slice(i, i + 500);
    let query = supabase
      .from("recurring_stream_transactions")
      .select("recurring_stream_id,transaction_id")
      .in("recurring_stream_id", chunk)
      .limit(DEPENDENCY_LIMIT);
    if (userId) query = query.eq("user_id", userId);
    const result = await query;
    assertRecurringQuery("recurring_stream_transactions", result);
    rows.push(...((result.data ?? []) as JoinRow[]));
  }
  return rows;
}

async function loadTransactionDates(
  supabase: SupabaseClient,
  transactionIds: string[],
  userId: string | undefined,
): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  for (let i = 0; i < transactionIds.length; i += 500) {
    const chunk = transactionIds.slice(i, i + 500);
    let query = supabase.from("transactions").select("id,date").in("id", chunk).limit(500);
    if (userId) query = query.eq("user_id", userId);
    const result = await query;
    assertRecurringQuery("transactions", result);
    for (const row of (result.data ?? []) as TransactionDateRow[]) dates.set(row.id, row.date);
  }
  return dates;
}

export async function loadRecurringData(
  supabase: SupabaseClient,
  input: {
    userId: string;
    anchorMonth: string;
    rawScope?: string | string[];
    now?: Date;
  },
): Promise<RecurringLoadResult> {
  const householdResult = await supabase.from("households").select("id").limit(DEPENDENCY_LIMIT);
  assertRecurringQuery("households", householdResult);
  const visibleHouseholdIds = (householdResult.data ?? []).map((row) => row.id as string);
  const scope = parseFinancialScope({
    raw: input.rawScope,
    ownerUserId: input.userId,
    visibleHouseholdIds,
  });
  const userId = scopeQueryUserId(scope);

  let streamsQuery = supabase
    .from("recurring_streams")
    .select(
      "id,user_id,merchant_name,description,stream_type,status,is_active,reviewed_at,dismissed_at,user_amount,average_amount,last_amount,frequency,first_date,last_date,predicted_next_date,account_id,category",
    )
    .limit(DEPENDENCY_LIMIT);
  let manualQuery = supabase
    .from("manual_recurring_items")
    .select("id,name,amount,frequency,next_date,item_type,category,enabled")
    .limit(DEPENDENCY_LIMIT);
  let accountsQuery = supabase
    .from("accounts")
    .select("id,name,type,subtype,iso_currency_code")
    .limit(DEPENDENCY_LIMIT);
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .eq("job_type", "transactions")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (userId) {
    streamsQuery = streamsQuery.eq("user_id", userId);
    manualQuery = manualQuery.eq("user_id", userId);
    accountsQuery = accountsQuery.eq("user_id", userId);
    syncQuery = syncQuery.eq("user_id", userId);
  }

  const [streamsResult, manualResult, accountsResult, syncResult] = await Promise.all([
    streamsQuery,
    manualQuery,
    accountsQuery,
    syncQuery.maybeSingle(),
  ]);
  assertRecurringQuery("recurring_streams", streamsResult);
  assertRecurringQuery("manual_recurring_items", manualResult);
  assertRecurringQuery("accounts", accountsResult);
  assertRecurringQuery("sync_jobs", syncResult);

  const streamRows = (streamsResult.data ?? []) as RecurringStreamRawRow[];
  const streamIds = streamRows.map((row) => row.id);

  const joinRows = await loadJoinRows(supabase, streamIds, userId);

  const transactionIds = [...new Set(joinRows.map((row) => row.transaction_id))];
  const transactionDatesById = await loadTransactionDates(supabase, transactionIds, userId);

  const matchedByStreamId = new Map<string, { id: string; date: string }[]>();
  for (const row of joinRows) {
    const date = transactionDatesById.get(row.transaction_id);
    if (!date) continue;
    const existing = matchedByStreamId.get(row.recurring_stream_id) ?? [];
    existing.push({ id: row.transaction_id, date });
    matchedByStreamId.set(row.recurring_stream_id, existing);
  }

  const accountById = new Map(
    ((accountsResult.data ?? []) as AccountRow[]).map((row) => [row.id, row]),
  );

  const streamInputs: RecurringStreamInput[] = streamRows.map((row) => {
    const account = row.account_id ? accountById.get(row.account_id) : undefined;
    const frequency = KNOWN_FREQUENCIES.has(row.frequency ?? "")
      ? (row.frequency as RecurringStreamInput["frequency"])
      : "UNKNOWN";
    const status = KNOWN_STATUSES.has(row.status ?? "")
      ? (row.status as RecurringStreamStatus)
      : "UNKNOWN";
    return {
      id: row.id,
      streamType: row.stream_type,
      merchantName: row.merchant_name,
      description: row.description,
      averageAmount: row.average_amount === null ? null : Number(row.average_amount),
      lastAmount: row.last_amount === null ? null : Number(row.last_amount),
      userAmount: row.user_amount === null ? null : Number(row.user_amount),
      frequency,
      status,
      isActive: row.is_active,
      accountName: account?.name ?? null,
      isCreditAccount: account ? groupKeyFor(account.type, account.subtype) === "credit" : false,
      firstDate: row.first_date,
      lastDate: row.last_date,
      predictedNextDate: row.predicted_next_date,
      reviewedAt: row.reviewed_at,
      dismissedAt: row.dismissed_at,
      matchedTransactions: matchedByStreamId.get(row.id) ?? [],
      category: row.category,
    };
  });

  const manualRows = (manualResult.data ?? []) as ManualRecurringRawRow[];
  const manualInputs: ManualRecurringItemInput[] = manualRows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    frequency: row.frequency as ManualRecurringFrequency,
    nextDate: row.next_date,
    itemType: row.item_type,
    category: row.category,
    enabled: row.enabled,
  }));

  const lastSuccessfulSyncAt =
    ((syncResult.data as SyncRow | null)?.updated_at as string | undefined) ?? null;

  // Household scope's queries above are unscoped by design (RLS does the
  // filtering so household members can see each other's shared streams), so
  // `streamInputs`/`streamRows` can include other members' rows. The review
  // banner must only ever count the actual caller's own unreviewable
  // streams — the same rows the sidebar badge counts — otherwise the banner
  // and badge disagree, and confirming a co-owner's stream from the All tab
  // would 404 against `PATCH /api/recurring`, which is always scoped to the
  // real caller.
  const ownerStreamIds = new Set(
    streamRows.filter((row) => row.user_id === input.userId).map((row) => row.id),
  );
  const ownerScopedInputs = streamInputs.filter((streamInput) => ownerStreamIds.has(streamInput.id));

  return {
    view: {
      ...expandStreamsForMonth(
        streamInputs,
        manualInputs,
        input.anchorMonth,
        (input.now ?? new Date()).toISOString().slice(0, 10),
      ),
      reviewCount: countUnreviewedStreams(ownerScopedInputs),
    },
    scope,
    visibleHouseholdIds,
    allStreams: streamRows.map((row) => ({
      id: row.id,
      merchantName: row.merchant_name,
      description: row.description,
      streamType: row.stream_type,
      status: KNOWN_STATUSES.has(row.status ?? "") ? (row.status as RecurringStreamStatus) : "UNKNOWN",
      isActive: row.is_active,
      reviewedAt: row.reviewed_at,
      dismissedAt: row.dismissed_at,
      userAmount: row.user_amount === null ? null : Number(row.user_amount),
      averageAmount: row.average_amount === null ? null : Number(row.average_amount),
      accountName: row.account_id ? accountById.get(row.account_id)?.name ?? null : null,
      isOwn: row.user_id === input.userId,
    })),
    manualItems: manualInputs,
    stale: isStale(lastSuccessfulSyncAt, input.now ?? new Date()),
    currency: dominantCurrency((accountsResult.data ?? []) as AccountRow[]),
  };
}
