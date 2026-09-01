import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseFinancialScope,
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";
import {
  buildCreditCardBucket,
  type CreditCardBill,
} from "@/lib/recurring-credit-bill";
import {
  countUnreviewedStreams,
  expandStreamsForMonth,
  type ManualRecurringFrequency,
  type ManualRecurringItemInput,
  type RecurringDetectionEvidence,
  type RecurringMonth,
  type RecurringStreamInput,
  type RecurringStreamSource,
  type RecurringStreamStatus,
} from "@/lib/recurring-page";
import { localDateKey } from "@/lib/format-date";

const PAGE_SIZE = 1_000;

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
  source?: string | null;
  detection_evidence?: unknown;
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
  source: RecurringStreamSource;
  detectionEvidence: RecurringDetectionEvidence | null;
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

const KNOWN_FREQUENCIES = new Set([
  "WEEKLY",
  "BIWEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
]);
const AMOUNT_PATTERNS = new Set(["fixed", "price_step", "variable"]);

/**
 * Evidence is jsonb written by the detector, but legacy and hand-edited rows
 * can hold anything. Parse structurally and fall back to null rather than
 * trusting the column, so one malformed row cannot break the page.
 */
function parseDetectionEvidence(value: unknown): RecurringDetectionEvidence | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.occurrenceCount !== "number" || !Number.isFinite(raw.occurrenceCount)) return null;
  if (typeof raw.amountPattern !== "string" || !AMOUNT_PATTERNS.has(raw.amountPattern)) return null;
  const deviation = raw.maximumCadenceDeviationDays;
  const signifiers = raw.matchedSignifiers;
  return {
    occurrenceCount: raw.occurrenceCount,
    amountPattern: raw.amountPattern as RecurringDetectionEvidence["amountPattern"],
    maximumCadenceDeviationDays:
      typeof deviation === "number" && Number.isFinite(deviation) ? deviation : 0,
    matchedSignifiers: Array.isArray(signifiers)
      ? signifiers.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}
const KNOWN_STATUSES = new Set(["MATURE", "EARLY_DETECTION", "TOMBSTONED"]);

async function loadPagedRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data?: unknown; error: { code?: string } | null }>,
  table: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await loadPage(from, from + PAGE_SIZE - 1);
    assertRecurringQuery(table, result);
    const batch = (result.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

async function loadJoinRows(
  supabase: SupabaseClient,
  streamIds: string[],
  userId: string | undefined,
): Promise<JoinRow[]> {
  const rows: JoinRow[] = [];
  for (let i = 0; i < streamIds.length; i += 500) {
    const chunk = streamIds.slice(i, i + 500);
    const chunkRows = await loadPagedRows<JoinRow>(
      (from, to) => {
        let query = supabase
          .from("recurring_stream_transactions")
          .select("recurring_stream_id,transaction_id")
          .in("recurring_stream_id", chunk)
          .order("recurring_stream_id")
          .order("transaction_id")
          .range(from, to);
        if (userId) query = query.eq("user_id", userId);
        return query;
      },
      "recurring_stream_transactions",
    );
    rows.push(...chunkRows);
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
    let query = supabase
      .from("transactions")
      .select("id,date")
      .in("id", chunk)
      .order("id")
      .range(0, chunk.length - 1);
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
    today?: string;
  },
): Promise<RecurringLoadResult> {
  const householdRows = await loadPagedRows<{ id: string }>(
    (from, to) =>
      supabase.from("households").select("id").order("id").range(from, to),
    "households",
  );
  const visibleHouseholdIds = householdRows.map((row) => row.id);
  const scope = parseFinancialScope({
    raw: input.rawScope,
    ownerUserId: input.userId,
    visibleHouseholdIds,
  });
  const userId = scopeQueryUserId(scope);

  const streamsPromise = loadPagedRows<RecurringStreamRawRow>(
    (from, to) => {
      let query = supabase
        .from("recurring_streams")
        .select(
          "id,user_id,merchant_name,description,stream_type,status,is_active,reviewed_at,dismissed_at,user_amount,average_amount,last_amount,frequency,first_date,last_date,predicted_next_date,account_id,category,source,detection_evidence",
        )
        .order("id")
        .range(from, to);
      if (userId) query = query.eq("user_id", userId);
      return query;
    },
    "recurring_streams",
  );
  const manualPromise = loadPagedRows<ManualRecurringRawRow>(
    (from, to) => {
      let query = supabase
        .from("manual_recurring_items")
        .select("id,name,amount,frequency,next_date,item_type,category,enabled")
        .order("id")
        .range(from, to);
      if (userId) query = query.eq("user_id", userId);
      return query;
    },
    "manual_recurring_items",
  );
  const accountsPromise = loadPagedRows<AccountRow>(
    (from, to) => {
      let query = supabase
        .from("accounts")
        .select("id,name,type,subtype,iso_currency_code")
        .order("id")
        .range(from, to);
      if (userId) query = query.eq("user_id", userId);
      return query;
    },
    "accounts",
  );
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .eq("job_type", "transactions")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (userId) syncQuery = syncQuery.eq("user_id", userId);

  const billsPromise = loadPagedRows<{
    account_id: string;
    statement_balance: number | string | null;
    minimum_payment: number | string | null;
    due_date: string | null;
  }>(
    (from, to) => {
      let query = supabase
        .from("credit_card_bills")
        .select("account_id, statement_balance, minimum_payment, due_date")
        .order("account_id")
        .range(from, to);
      if (userId) query = query.eq("user_id", userId);
      return query;
    },
    "credit_card_bills",
  );

  const [streamRows, manualRows, accountRows, syncResult, billRows] = await Promise.all([
    streamsPromise,
    manualPromise,
    accountsPromise,
    syncQuery.maybeSingle(),
    billsPromise,
  ]);
  assertRecurringQuery("sync_jobs", syncResult);
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

  const accountById = new Map(accountRows.map((row) => [row.id, row]));

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
      firstDate: row.first_date,
      lastDate: row.last_date,
      predictedNextDate: row.predicted_next_date,
      reviewedAt: row.reviewed_at,
      dismissedAt: row.dismissed_at,
      matchedTransactions: matchedByStreamId.get(row.id) ?? [],
      category: row.category,
      // Rows written before the hybrid migration carry no source; they are
      // provider rows by definition.
      source: row.source === "inferred" ? "inferred" : "plaid",
      detectionEvidence: parseDetectionEvidence(row.detection_evidence),
    };
  });

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

  // Real credit-card bills populate the credit-card bucket; without bill
  // data the bucket stays empty (card purchases remain Expenses).
  const creditBills: CreditCardBill[] = billRows.map((bill) => ({
    accountId: bill.account_id,
    statementBalance: bill.statement_balance === null ? null : Number(bill.statement_balance),
    minimumPayment: bill.minimum_payment === null ? null : Number(bill.minimum_payment),
    dueDate: bill.due_date,
  }));
  const creditCardBucket = buildCreditCardBucket(creditBills, input.anchorMonth);
  const today = input.today ?? localDateKey(input.now ?? new Date());

  const expanded = expandStreamsForMonth(
    streamInputs,
    manualInputs,
    input.anchorMonth,
    today,
  );

  return {
    view: {
      ...expanded,
      totals: { ...expanded.totals, creditCards: creditCardBucket },
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
      source: row.source === "inferred" ? "inferred" as const : "plaid" as const,
      detectionEvidence: parseDetectionEvidence(row.detection_evidence),
    })),
    manualItems: manualInputs,
    stale: isStale(lastSuccessfulSyncAt, input.now ?? new Date()),
    currency: dominantCurrency(accountRows),
  };
}
