import type { SupabaseClient } from "@supabase/supabase-js";

export type SyncHealthState =
  | "healthy"
  | "stale"
  | "repair_required"
  | "product_unavailable"
  | "rate_limited"
  | "never_synced";

export interface ProductSyncHealth {
  state: SyncHealthState;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  safeErrorCode: string | null;
}

export interface InstitutionSyncHealth {
  plaidItemId: string;
  institutionName: string;
  transactions: ProductSyncHealth;
  investments: ProductSyncHealth;
  accountsUpdatedAt: string | null;
  oldestTransactionDate: string | null;
  newestTransactionDate: string | null;
}

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** Known safe provider error codes that can be displayed to users. */
const REPAIR_ERROR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "PENDING_EXPIRATION",
  "ITEM_LOCKED",
  "USER_SETUP_REQUIRED",
  "ACCESS_NOT_PERMITTED",
]);

const RATE_LIMIT_CODES = new Set([
  "RATE_LIMIT_EXCEEDED",
  "PLANNED_MAINTENANCE",
]);

const UNAVAILABLE_CODES = new Set([
  "NO_INVESTMENT_ACCOUNTS",
  "PRODUCTS_NOT_SUPPORTED",
  "PRODUCT_NOT_READY",
  "INVESTMENT_DATA_NOT_AVAILABLE",
]);

/** Sanitize an error code or message into a safe displayable enum or null. */
export function sanitizeErrorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  for (const code of REPAIR_ERROR_CODES) {
    if (upper.includes(code)) return code;
  }
  for (const code of RATE_LIMIT_CODES) {
    if (upper.includes(code)) return code;
  }
  for (const code of UNAVAILABLE_CODES) {
    if (upper.includes(code)) return code;
  }
  if (upper.includes("ERROR") || upper.includes("FAIL")) return "SYNC_FAILED";
  return null;
}

/**
 * Pure state evaluator for a single product sync health.
 */
export function evaluateProductHealth(params: {
  itemStatus: string | null;
  itemErrorCode: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastJobStatus: "pending" | "running" | "done" | "failed" | null;
  hasAccountsForProduct?: boolean;
  now?: Date;
}): ProductSyncHealth {
  const nowMs = (params.now ?? new Date()).getTime();
  const safeItemError = sanitizeErrorCode(params.itemErrorCode);
  const safeJobError = sanitizeErrorCode(params.lastError);
  const effectiveError = safeItemError ?? safeJobError;

  // 1. Repair required if item status is error or item-level error code requires login/consent
  if (
    params.itemStatus === "error" ||
    (safeItemError && REPAIR_ERROR_CODES.has(safeItemError)) ||
    (safeJobError && REPAIR_ERROR_CODES.has(safeJobError))
  ) {
    return {
      state: "repair_required",
      lastSuccessAt: params.lastSuccessAt,
      lastAttemptAt: params.lastAttemptAt,
      safeErrorCode: effectiveError ?? "ITEM_LOGIN_REQUIRED",
    };
  }

  // 2. Rate limited
  if (
    (safeItemError && RATE_LIMIT_CODES.has(safeItemError)) ||
    (safeJobError && RATE_LIMIT_CODES.has(safeJobError))
  ) {
    return {
      state: "rate_limited",
      lastSuccessAt: params.lastSuccessAt,
      lastAttemptAt: params.lastAttemptAt,
      safeErrorCode: effectiveError,
    };
  }

  // 3. Product unavailable (e.g. no investment accounts or unsupported product)
  if (
    (safeItemError && UNAVAILABLE_CODES.has(safeItemError)) ||
    (safeJobError && UNAVAILABLE_CODES.has(safeJobError)) ||
    params.hasAccountsForProduct === false
  ) {
    return {
      state: "product_unavailable",
      lastSuccessAt: params.lastSuccessAt,
      lastAttemptAt: params.lastAttemptAt,
      safeErrorCode: effectiveError ?? (params.hasAccountsForProduct === false ? "NO_ACCOUNTS" : null),
    };
  }

  // 4. Never synced
  if (!params.lastSuccessAt && !params.lastAttemptAt) {
    return {
      state: "never_synced",
      lastSuccessAt: null,
      lastAttemptAt: null,
      safeErrorCode: null,
    };
  }

  // 5. Stale check
  const lastSuccessMs = params.lastSuccessAt ? Date.parse(params.lastSuccessAt) : 0;
  const isTimeStale = !lastSuccessMs || nowMs - lastSuccessMs > STALE_THRESHOLD_MS;
  const lastFailed = params.lastJobStatus === "failed";

  if (isTimeStale || lastFailed) {
    return {
      state: "stale",
      lastSuccessAt: params.lastSuccessAt,
      lastAttemptAt: params.lastAttemptAt,
      safeErrorCode: effectiveError,
    };
  }

  return {
    state: "healthy",
    lastSuccessAt: params.lastSuccessAt,
    lastAttemptAt: params.lastAttemptAt,
    safeErrorCode: null,
  };
}

/**
 * Load sync health across all connected institutions for an authenticated user.
 */
export async function loadInstitutionsSyncHealth(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<InstitutionSyncHealth[]> {
  // Query plaid items, accounts, and recent sync jobs scoped to this user
  const [itemsRes, accountsRes, syncJobsRes] = await Promise.all([
    supabase
      .from("plaid_items")
      .select("id, institution_name, status, error_code, updated_at")
      .eq("user_id", userId)
      .order("created_at"),
    supabase
      .from("accounts")
      .select("id, plaid_item_id, type, subtype, updated_at")
      .eq("user_id", userId),
    supabase
      .from("sync_jobs")
      .select("plaid_item_id, job_type, status, last_error, updated_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const items = itemsRes.data ?? [];
  const accounts = accountsRes.data ?? [];
  const syncJobs = syncJobsRes.data ?? [];

  if (items.length === 0) return [];

  // Group accounts and account updated_at by plaid_item_id
  const accountsByItem = new Map<string, typeof accounts>();
  const accountIdsByItem = new Map<string, string[]>();
  for (const acc of accounts) {
    if (!acc.plaid_item_id) continue;
    const existing = accountsByItem.get(acc.plaid_item_id) ?? [];
    existing.push(acc);
    accountsByItem.set(acc.plaid_item_id, existing);

    const ids = accountIdsByItem.get(acc.plaid_item_id) ?? [];
    ids.push(acc.id);
    accountIdsByItem.set(acc.plaid_item_id, ids);
  }

  // Load oldest and newest transaction dates per item (bounded queries)
  const txDatesByItem = new Map<string, { oldest: string | null; newest: string | null }>();
  for (const [itemId, accIds] of accountIdsByItem.entries()) {
    if (accIds.length === 0) continue;
    const [oldestRes, newestRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("date")
        .eq("user_id", userId)
        .in("account_id", accIds)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("transactions")
        .select("date")
        .eq("user_id", userId)
        .in("account_id", accIds)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    txDatesByItem.set(itemId, {
      oldest: (oldestRes.data?.date as string | undefined) ?? null,
      newest: (newestRes.data?.date as string | undefined) ?? null,
    });
  }

  return items.map((item) => {
    const itemAccounts = accountsByItem.get(item.id) ?? [];
    const hasInvestmentAccounts = itemAccounts.some(
      (a) => a.type === "investment" || a.subtype === "brokerage" || a.subtype === "ira" || a.subtype === "401k",
    );
    const hasDepositoryOrCredit = itemAccounts.some(
      (a) => a.type === "depository" || a.type === "credit" || a.type === "loan",
    );

    // Latest account update timestamp
    const latestAccountUpdate = itemAccounts.reduce<string | null>((latest, acc) => {
      if (!acc.updated_at) return latest;
      if (!latest || acc.updated_at > latest) return acc.updated_at;
      return latest;
    }, null);

    // Latest jobs for transactions and investments
    const itemJobs = syncJobs.filter((j) => j.plaid_item_id === item.id);
    const txnDoneJob = itemJobs.find((j) => j.job_type === "transactions" && j.status === "done");
    const txnLatestJob = itemJobs.find((j) => j.job_type === "transactions");
    const invDoneJob = itemJobs.find((j) => j.job_type === "investments" && j.status === "done");
    const invLatestJob = itemJobs.find((j) => j.job_type === "investments");

    const txnHealth = evaluateProductHealth({
      itemStatus: item.status,
      itemErrorCode: item.error_code,
      lastSuccessAt: txnDoneJob?.updated_at ?? null,
      lastAttemptAt: txnLatestJob?.updated_at ?? null,
      lastError: txnLatestJob?.last_error ?? null,
      lastJobStatus: txnLatestJob?.status ?? null,
      hasAccountsForProduct: hasDepositoryOrCredit || itemAccounts.length === 0,
      now,
    });

    const invHealth = evaluateProductHealth({
      itemStatus: item.status,
      itemErrorCode: item.error_code,
      lastSuccessAt: invDoneJob?.updated_at ?? null,
      lastAttemptAt: invLatestJob?.updated_at ?? null,
      lastError: invLatestJob?.last_error ?? null,
      lastJobStatus: invLatestJob?.status ?? null,
      hasAccountsForProduct: hasInvestmentAccounts,
      now,
    });

    const txDates = txDatesByItem.get(item.id);

    return {
      plaidItemId: item.id,
      institutionName: item.institution_name ?? "Unknown Institution",
      transactions: txnHealth,
      investments: invHealth,
      accountsUpdatedAt: latestAccountUpdate ?? item.updated_at ?? null,
      oldestTransactionDate: txDates?.oldest ?? null,
      newestTransactionDate: txDates?.newest ?? null,
    };
  });
}
