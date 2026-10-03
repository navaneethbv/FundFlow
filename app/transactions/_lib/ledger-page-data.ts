import { accountDisplayLabel } from "@/lib/account-label";
import type { createClient } from "@/lib/supabase/server";
import { hasRemapRules } from "@/lib/ledger-filter";
import { normalizeLedgerAmount, type parseLedgerQuery, type LedgerReviewFilter } from "@/lib/ledger-query";
import { collectLedgerChunks, ledgerDatabaseOrder, needsProjectedLedgerPage, selectProjectedLedgerPage } from "@/lib/ledger-data";
import {
  buildLedgerFilterOptions, filterProjectedLedgerRows, projectLedgerRows, toLedgerFacetRow,
  type LedgerFacetSourceRow, type LedgerFilterOptions, type LedgerProjectedRow, type LedgerProjectionSourceRow,
} from "@/lib/ledger-projection";
import { applyPlaidCategoryMapping } from "@/lib/plaid-category-mapping";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { attachLedgerRuleActions } from "@/lib/rule-ledger";
import { annotationProjectionColumns, storedRuleActions, tagsWithRuleActions, type RuleActions } from "@/lib/rule-actions";

export const LEDGER_PAGE_SIZE = 50;
const PAGE_SIZE = LEDGER_PAGE_SIZE;
type TransactionsSupabase = Awaited<ReturnType<typeof createClient>>;

export type LedgerChunkFilters = {
  bounds: { start: string; end: string } | null;
  ownerId: string;
  accountId: string;
  q: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
  transactionsParityEnabled: boolean;
  transactionReviewEnabled: boolean;
  reviewFilter: LedgerReviewFilter;
  typedIds: string[];
  missingAccountId: string;
  minAmount?: string;
  maxAmount?: string;
  status?: "" | "pending" | "posted";
};

/**
 * Filters only, deliberately unordered. postgrest-js appends `order()` calls in
 * the order they are made, so an ordering baked in here would win over the sort
 * the caller asks for afterwards and the ledger would ignore `?sort=`.
 */
function buildLedgerFilterQuery(
  supabase: TransactionsSupabase,
  columns: string,
  filters: LedgerChunkFilters,
  count = false,
) {
  const sourceTable = filters.transactionReviewEnabled
    ? "transaction_review_ledger"
    : "transactions";

  let query = supabase
    .from(sourceTable)
    .select(columns, count ? { count: "exact" } : undefined)
    .eq("user_id", filters.ownerId);

  if (filters.transactionReviewEnabled && filters.reviewFilter !== "all") {
    query = query.eq("review_status", filters.reviewFilter).eq("review_eligible", true);
  }

  if (filters.bounds) {
    query = query
      .gte("date", filters.bounds.start)
      .lte("date", filters.bounds.end);
  }
  if (filters.accountId) {
    query = filters.transactionsParityEnabled
      ? query.or(
          `account_id.eq.${filters.accountId},manual_account_id.eq.${filters.accountId}`,
        )
      : query.eq("account_id", filters.accountId);
  }
  if (filters.q) {
    const categorySearch = filters.q.replace(/\s+/g, "_");
    query = query.or(
      `merchant_name.ilike.%${filters.q}%,name.ilike.%${filters.q}%,pfc_primary.ilike.%${categorySearch}%,pfc_detailed.ilike.%${categorySearch}%`,
    );
  }
  if (filters.flow === "in") query = query.lt("amount", 0);
  if (filters.flow === "out") query = query.gt("amount", 0);
  const minimum = normalizeLedgerAmount(filters.minAmount ?? "");
  const maximum = normalizeLedgerAmount(filters.maxAmount ?? "");
  if (minimum) query = query.or(`amount.gte.${minimum},amount.lte.-${minimum}`);
  if (maximum) query = query.gte("amount", -Number(maximum)).lte("amount", Number(maximum));
  if (filters.status) query = query.eq("pending", filters.status === "pending");
  if (filters.accountType) {
    query = query.in(
      "account_id",
      filters.typedIds.length ? filters.typedIds : [filters.missingAccountId],
    );
  }
  return query;
}

/**
 * A chunked scan pages with `range()`, so it needs a total order or the windows
 * can overlap and drop rows. Scans feed projection and facets, never the
 * user-visible row order, so this order is fixed rather than sort-driven.
 */
function buildLedgerScanQuery(
  supabase: TransactionsSupabase,
  columns: string,
  filters: LedgerChunkFilters,
) {
  return buildLedgerFilterQuery(supabase, columns, filters)
    .order("date", { ascending: false })
    .order("id", { ascending: true });
}

type LedgerRules = Array<{
  matchType: "merchant" | "keyword" | "account";
  pattern: string;
  displayName: string | null;
  category: string | null;
  enabled: boolean;
}>;

export async function loadLedgerRows(input: {
  supabase: TransactionsSupabase;
  state: ReturnType<typeof parseLedgerQuery>;
  filters: LedgerChunkFilters;
  columns: string;
  rules: LedgerRules;
  accountNamesById: Map<string, string>;
  accountLabelsById: Map<string, string>;
  accountOptionsForFilters: { value: string; label: string }[];
  categoryMappings: ReadonlyMap<string, string>;
  ledgerError: string;
}): Promise<{
  rows: LedgerProjectedRow[];
  total: number;
  projectedScope: LedgerProjectedRow[];
  allRowsForGrouping: LedgerProjectedRow[] | null;
  incompleteDates: Set<string>;
  filterOptions: LedgerFilterOptions;
  ledgerError: string;
}> {
  const { supabase, state, filters, columns, rules, accountNamesById, accountLabelsById, accountOptionsForFilters } = input;
  let ledgerError = input.ledgerError;
  const ruleAwareFilter = Boolean(state.category || state.merchant) && (hasRemapRules(rules) || input.categoryMappings.size > 0);
  const projectedPath = isFeatureEnabled("compoundRules") || needsProjectedLedgerPage(state.sort, ruleAwareFilter) || state.view === "calendar";
  const needsFullProjection = projectedPath || hasRemapRules(rules);
  let projectedScope: LedgerProjectedRow[] = [];
  let allRowsForGrouping: LedgerProjectedRow[] | null = null;
  let incompleteDates = new Set<string>();
  if (needsFullProjection) {
    try {
      const sourceRows = await collectLedgerChunks<LedgerProjectionSourceRow>(async (from, to) => {
        const result = await buildLedgerScanQuery(supabase, columns, filters).range(from, to);
        return { rows: (result.data ?? []) as unknown as LedgerProjectionSourceRow[], error: result.error };
      });
      const mappedRows = sourceRows.map((row) => applyPlaidCategoryMapping(row, input.categoryMappings));
      projectedScope = projectLedgerRows(await attachLedgerRuleActions(supabase, filters.ownerId, mappedRows), rules, accountNamesById, accountLabelsById);
    } catch (error) {
      console.error("Transaction projection query failed", error instanceof Error ? error.message : "unknown");
      ledgerError = "We couldn't load your transactions. Try changing the filters or refresh the page.";
    }
  }
  let rows: LedgerProjectedRow[] = [];
  let total = 0;
  if (!ledgerError && projectedPath) {
    const selected = selectProjectedLedgerPage(projectedScope, { ...state, pageSize: PAGE_SIZE });
    rows = selected.rows;
    total = selected.total;
    allRowsForGrouping = filterProjectedLedgerRows(projectedScope, {
      category: state.category,
      sub: state.sub,
      merchant: state.merchant,
    });
  } else if (!ledgerError) {
    const result = await loadDirectLedgerRows({ ...input, projectedPath });
    if (result.error) {
      console.error("Transaction page query failed", result.error);
      ledgerError = "We couldn't load your transactions. Try changing the filters or refresh the page.";
    } else {
      rows = result.rows;
      total = result.total;
      incompleteDates = result.incompleteDates;
    }
  }
  const filterOptions = await loadLedgerFilterOptions({
    supabase,
    filters,
    projectedScope,
    needsFullProjection,
    accountOptionsForFilters,
  });
  return {
    rows,
    total,
    projectedScope,
    allRowsForGrouping,
    incompleteDates,
    filterOptions,
    ledgerError,
  };
}

async function loadDirectLedgerRows(input: {
  supabase: TransactionsSupabase;
  state: ReturnType<typeof parseLedgerQuery>;
  filters: LedgerChunkFilters;
  columns: string;
  rules: LedgerRules;
  accountNamesById: Map<string, string>;
  accountLabelsById: Map<string, string>;
  accountOptionsForFilters: { value: string; label: string }[];
  ledgerError: string;
  projectedPath: boolean;
  categoryMappings: ReadonlyMap<string, string>;
}): Promise<{
  rows: LedgerProjectedRow[];
  total: number;
  error: string | null;
  incompleteDates: Set<string>;
}> {
  const { supabase, state, filters, columns, rules, accountNamesById, accountLabelsById } = input;
  let query = applyDirectLedgerFilters(
    buildLedgerFilterQuery(supabase, columns, filters, true),
    state,
  );
  for (const order of ledgerDatabaseOrder(state.sort === "amount" ? "amount" : "date", state.direction)) {
    query = query.order(order.column, { ascending: order.ascending });
  }
  const offset = (state.page - 1) * PAGE_SIZE;
  const inspectNeighbors = state.sort === "date";
  const windowStart = inspectNeighbors ? Math.max(0, offset - 1) : offset;
  const windowEnd = inspectNeighbors ? offset + PAGE_SIZE : offset + PAGE_SIZE - 1;
  const result = await query.range(windowStart, windowEnd);
  if (result.error) {
    return {
      rows: [],
      total: 0,
      error: result.error.code ?? "unknown",
      incompleteDates: new Set<string>(),
    };
  }
  const windowRows = projectLedgerRows(
    ((result.data ?? []) as unknown as LedgerProjectionSourceRow[]).map((row) => applyPlaidCategoryMapping(row, input.categoryMappings)),
    rules,
    accountNamesById,
    accountLabelsById,
  );
  const visibleStart = offset - windowStart;
  const rows = windowRows.slice(visibleStart, visibleStart + PAGE_SIZE);
  const incompleteDates = findIncompleteLedgerDates(windowRows, rows, visibleStart, inspectNeighbors);
  return {
    rows,
    total: result.count ?? rows.length,
    error: null,
    incompleteDates,
  };
}

function applyDirectLedgerFilters(
  initialQuery: ReturnType<typeof buildLedgerFilterQuery>,
  state: ReturnType<typeof parseLedgerQuery>,
) {
  let query = initialQuery;
  if (state.category) {
    query = state.category === "UNCATEGORIZED"
      ? query.or("pfc_primary.is.null,pfc_primary.eq.UNCATEGORIZED")
      : query.eq("pfc_primary", state.category);
  }
  if (state.sub) query = query.eq("pfc_detailed", state.sub);
  if (state.merchant) query = query.or(`merchant_name.ilike.${state.merchant},name.ilike.${state.merchant}`);
  return query;
}

function findIncompleteLedgerDates(
  windowRows: readonly LedgerProjectedRow[],
  rows: readonly LedgerProjectedRow[],
  visibleStart: number,
  inspectNeighbors: boolean,
): Set<string> {
  const incompleteDates = new Set<string>();
  const first = rows[0];
  const last = rows.at(-1);
  if (!inspectNeighbors || !first || !last) return incompleteDates;
  const previous = windowRows[visibleStart - 1];
  const next = windowRows[visibleStart + rows.length];
  if (previous?.date === first.date) incompleteDates.add(first.date);
  if (next?.date === last.date) incompleteDates.add(last.date);
  return incompleteDates;
}

async function loadLedgerFilterOptions(input: {
  supabase: TransactionsSupabase;
  filters: LedgerChunkFilters;
  projectedScope: LedgerProjectedRow[];
  needsFullProjection: boolean;
  accountOptionsForFilters: { value: string; label: string }[];
}): Promise<LedgerFilterOptions> {
  if (input.needsFullProjection) return buildLedgerFilterOptions(input.projectedScope, input.accountOptionsForFilters);
  try {
    const facetRows = await collectLedgerChunks<LedgerFacetSourceRow>(async (from, to) => {
      const result = await buildLedgerScanQuery(input.supabase, "pfc_primary, pfc_detailed, merchant_name, name", input.filters).range(from, to);
      return { rows: (result.data ?? []) as unknown as LedgerFacetSourceRow[], error: result.error };
    });
    return buildLedgerFilterOptions(facetRows.map(toLedgerFacetRow), input.accountOptionsForFilters);
  } catch (error) {
    console.error("Transaction facet query failed", error instanceof Error ? error.message : "unknown");
    return buildLedgerFilterOptions([], input.accountOptionsForFilters);
  }
}

/**
 * The three account lookups the ledger needs, over both FKs a row can carry —
 * a manual transaction (Phase 12) has no `account_id`.
 *
 * `accountNamesById` is the name *without* the mask, for rule matching: it
 * mirrors the dashboard so the ledger's rules-applied filter agrees with the
 * drill it came from. `accountLabelsById` is the display form.
 */
export function buildAccountLookups(
  accounts: ReadonlyArray<{ id: unknown; name: unknown; mask?: unknown }>,
  manualAccounts: ReadonlyArray<{ id: unknown; name: unknown }>,
): {
  accountNamesById: Map<string, string>;
  accountLabelsById: Map<string, string>;
  accountOptions: Array<{ id: string; name: string; source: "plaid" | "manual" }>;
} {
  const accountText = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;

  return {
    accountNamesById: new Map([
      ...accounts.map((a) => [a.id as string, accountText(a.name, "")] as const),
      ...manualAccounts.map((a) => [a.id as string, accountText(a.name, "")] as const),
    ]),
    accountLabelsById: new Map([
      ...accounts.map((a) => {
        const mask = accountText(a.mask, "");
        return [a.id as string, accountDisplayLabel(accountText(a.name, "Account"), mask)] as const;
      }),
      ...manualAccounts.map((a) => [a.id as string, `${accountText(a.name, "Account")} (manual)`] as const),
    ]),
    accountOptions: [
      ...accounts.map((a) => ({ id: a.id as string, name: accountDisplayLabel(accountText(a.name, "Account"), accountText(a.mask, "")), source: "plaid" as const })),
      ...manualAccounts.map((a) => ({ id: a.id as string, name: accountText(a.name, "Account"), source: "manual" as const })),
    ],
  };
}

/**
 * Per-row user annotations, splits, and duplicate exclusions for the visible
 * page. `transaction_splits` is readable for any transaction the caller can
 * see, which now includes a household member's shared rows, every query
 * filters to the caller's own so their categories are never rewritten by
 * someone else's.
 */
type CashFlowClassification = "expense" | "income" | null;
export type TransactionOverride = {
  displayCategory: string | null;
  cashFlowClassification: CashFlowClassification;
  ruleActions?: RuleActions;
};

export async function loadLedgerRowDetails(
  supabase: TransactionsSupabase,
  ownerId: string,
  txnIds: string[],
): Promise<{
  annById: Map<string, { note: string | null; tags: string[]; cleared: boolean }>;
  overridesById: Map<string, TransactionOverride>;
  splitsById: Map<string, Array<{ category: string; amount: number }>>;
  excludedDuplicateIds: Set<string>;
  failed: boolean;
}> {
  const annById = new Map<string, { note: string | null; tags: string[]; cleared: boolean }>();
  const overridesById = new Map<string, TransactionOverride>();
  const splitsById = new Map<string, Array<{ category: string; amount: number }>>();
  if (txnIds.length === 0) {
    return { annById, overridesById, splitsById, excludedDuplicateIds: new Set<string>(), failed: false };
  }

  const [annotationsResult, splitsResult, duplicatesResult] = await Promise.all([
    supabase.from("transaction_annotations").select(annotationProjectionColumns("transaction_id, note, tags, display_category, cash_flow_classification, cleared_at")).eq("user_id", ownerId).in("transaction_id", txnIds),
    supabase.from("transaction_splits").select("transaction_id, category, amount").eq("user_id", ownerId).in("transaction_id", txnIds),
    supabase.from("linked_duplicates").select("excluded_transaction_id").eq("user_id", ownerId).in("excluded_transaction_id", txnIds),
  ]);

  const errorCodes = [
    annotationsResult.error?.code,
    splitsResult.error?.code,
    duplicatesResult.error?.code,
  ].filter(Boolean);
  if (errorCodes.length > 0) {
    console.error("Transaction detail query failed", errorCodes);
  }

  for (const a of annotationsResult.data ?? []) {
    annById.set(a.transaction_id as string, {
      note: a.note as string | null,
      tags: tagsWithRuleActions(Array.isArray(a.tags) ? (a.tags as string[]) : [], storedRuleActions(a)),
      cleared: a.cleared_at != null,
    });
    const classification = a.cash_flow_classification;
    overridesById.set(a.transaction_id as string, {
      displayCategory: (a.display_category as string | null) ?? null,
      ruleActions: storedRuleActions(a),
      cashFlowClassification:
        classification === "expense" || classification === "income" ? classification : null,
    });
  }
  for (const s of splitsResult.data ?? []) {
    const list = splitsById.get(s.transaction_id as string) ?? [];
    list.push({ category: s.category as string, amount: Number(s.amount) });
    splitsById.set(s.transaction_id as string, list);
  }
  const excludedDuplicateIds = new Set(
    (duplicatesResult.data ?? []).map((row) => row.excluded_transaction_id as string),
  );

  return { annById, overridesById, splitsById, excludedDuplicateIds, failed: errorCodes.length > 0 };
}
