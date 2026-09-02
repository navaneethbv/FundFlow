import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import RefundReview from "@/components/transactions/RefundReview";
import DuplicateReview from "@/components/transactions/DuplicateReview";
import ScheduledTransactionsSection from "@/components/transactions/ScheduledTransactionsSection";
import TransferReview from "@/components/transactions/TransferReview";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import MobileLedgerList, { type LedgerCardRow } from "@/components/transactions/MobileLedgerList";
import SavedViewsBar from "@/components/transactions/SavedViewsBar";
import BulkTagBar from "@/components/transactions/BulkTagBar";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import ColumnsMenu from "@/components/transactions/ColumnsMenu";
import TableToolbar from "@/components/transactions/TableToolbar";
import TransactionQueryControls from "@/components/transactions/TransactionQueryControls";
import TransactionSortMenu from "@/components/transactions/TransactionSortMenu";
import { MerchantAvatar } from "@/components/ui/Avatar";
import { merchantLogoDataUri } from "@/lib/merchant-logos";
import CategoryChip from "@/components/ui/CategoryChip";
import { formatCurrency, roundsToZero, titleCase, formatMonth } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { hasRemapRules } from "@/lib/ledger-filter";
import {
  hasActiveLedgerFilters,
  ledgerHref,
  ledgerQueryEntries,
  parseLedgerQuery,
  savedLedgerViewParams,
  type LedgerRawSearchParams,
} from "@/lib/ledger-query";
import {
  collectLedgerChunks,
  ledgerZebraBands,
  ledgerDatabaseOrder,
  needsProjectedLedgerPage,
  selectProjectedLedgerPage,
  buildLedgerDayGroups,
  shouldShowLedgerDayGroups,
} from "@/lib/ledger-data";
import {
  buildLedgerFilterOptions,
  filterProjectedLedgerRows,
  projectLedgerRows,
  toLedgerFacetRow,
  type LedgerFacetSourceRow,
  type LedgerFilterOptions,
  type LedgerProjectedRow,
  type LedgerProjectionSourceRow,
} from "@/lib/ledger-projection";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<LedgerRawSearchParams>;
}

function monthBounds(month: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

type LedgerChunkFilters = {
  bounds: ReturnType<typeof monthBounds>;
  ownerId: string;
  accountId: string;
  q: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
  transactionsParityEnabled: boolean;
  typedIds: string[];
  missingAccountId: string;
};

type TransactionsSupabase = Awaited<ReturnType<typeof createClient>>;

function transactionSetupError(
  results: ReadonlyArray<{ error: { code?: string } | null }>,
): string {
  const errors = results.map((result) => result.error).filter(Boolean);
  if (errors.length === 0) return "";
  console.error("Transaction setup query failed", errors.map((error) => error?.code ?? "unknown"));
  return "We couldn't load your transaction controls. Try again.";
}

function transactionDetailsError(currentError: string, failed: boolean): string {
  return failed
    ? "We couldn't load transaction details. Refresh the page to try again."
    : currentError;
}

function ledgerNetPrefix(net: number): string {
  if (roundsToZero(net)) return "";
  if (net < 0) return "+";
  if (net > 0) return "-";
  return "";
}

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
  let query = supabase
    .from("transactions")
    .select(columns, count ? { count: "exact" } : undefined)
    .eq("user_id", filters.ownerId);
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

async function loadLedgerRows(input: {
  supabase: TransactionsSupabase;
  state: ReturnType<typeof parseLedgerQuery>;
  filters: LedgerChunkFilters;
  columns: string;
  rules: LedgerRules;
  accountNamesById: Map<string, string>;
  accountLabelsById: Map<string, string>;
  accountOptionsForFilters: { value: string; label: string }[];
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
  const ruleAwareFilter = Boolean(state.category || state.merchant) && hasRemapRules(rules);
  const projectedPath = needsProjectedLedgerPage(state.sort, ruleAwareFilter);
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
      projectedScope = projectLedgerRows(sourceRows, rules, accountNamesById, accountLabelsById);
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
    (result.data ?? []) as unknown as LedgerProjectionSourceRow[],
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
  if (!inspectNeighbors || rows.length === 0) return incompleteDates;
  const previous = windowRows[visibleStart - 1];
  const next = windowRows[visibleStart + rows.length];
  const first = rows[0]!;
  const last = rows.at(-1)!;
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
function buildAccountLookups(
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
        const maskLabel = mask ? ` ••${mask}` : "";
        return [a.id as string, `${accountText(a.name, "Account")}${maskLabel}`] as const;
      }),
      ...manualAccounts.map((a) => [a.id as string, `${accountText(a.name, "Account")} (manual)`] as const),
    ]),
    accountOptions: [
      ...accounts.map((a) => ({ id: a.id as string, name: accountText(a.name, "Account"), source: "plaid" as const })),
      ...manualAccounts.map((a) => ({ id: a.id as string, name: accountText(a.name, "Account"), source: "manual" as const })),
    ],
  };
}

/**
 * Per-row user annotations, splits, and duplicate exclusions for the visible
 * page. `transaction_splits` is readable for any transaction the caller can
 * see, which now includes a household member's shared rows — every query
 * filters to the caller's own so their categories are never rewritten by
 * someone else's.
 */
type CashFlowClassification = "expense" | "income" | null;
type TransactionOverride = {
  displayCategory: string | null;
  cashFlowClassification: CashFlowClassification;
};

async function loadLedgerRowDetails(
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
    supabase.from("transaction_annotations").select("transaction_id, note, tags, display_category, cash_flow_classification, cleared_at").eq("user_id", ownerId).in("transaction_id", txnIds),
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
      tags: (a.tags as string[]) ?? [],
      cleared: a.cleared_at != null,
    });
    const classification = a.cash_flow_classification;
    overridesById.set(a.transaction_id as string, {
      displayCategory: (a.display_category as string | null) ?? null,
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

interface LedgerTableRowProps {
  row: LedgerProjectedRow;
  /** Position within its date group when day grouping is active. */
  zebraBand: number;
  /** Render the day-group header above this row. */
  isNewDay: boolean;
  grouped: boolean;
  dayGroup: import("@/lib/ledger-data").LedgerDayGroup | undefined;
  visibleColumns: ReadonlySet<string>;
  excludedDuplicate: boolean;
  note: string | null;
  tags: string[];
  cleared: boolean;
  splits: Array<{ category: string; amount: number }>;
  categoryOptions: string[];
  providerCategory?: string | null;
  override?: { displayCategory: string | null; cashFlowClassification: "expense" | "income" | null } | null;
}

/**
 * One desktop ledger row, plus the day-group header that precedes the first
 * row of each date. Split out of the page so the page body stays readable:
 * the optional column/badge/annotation branches all live here.
 */
function LedgerTableRow({
  row,
  zebraBand,
  isNewDay,
  grouped,
  dayGroup,
  visibleColumns,
  excludedDuplicate,
  note,
  tags,
  cleared,
  splits,
  categoryOptions,
  providerCategory = null,
  override = null,
}: Readonly<LedgerTableRowProps>) {
  const columnCount =
    4 + (visibleColumns.has("category") ? 1 : 0) + (visibleColumns.has("account") ? 1 : 0);
  const hasAnnotations = Boolean(note) || tags.length > 0 || splits.length > 0 || cleared;
  const merchant = row.merchant || "Unknown";
  const currency = row.iso_currency_code ?? "USD";
  const isMoneyIn = row.amount < 0 && !roundsToZero(row.amount);
  const showsAmount = !roundsToZero(row.amount);
  const amountSign = isMoneyIn ? "+" : "-";
  const amountDisplay = showsAmount
    ? `${amountSign}${formatCurrency(Math.abs(row.amount), currency)}`
    : formatCurrency(0, currency);

  return (
    <Fragment>
      {isNewDay && (
        <tr className="border-b border-panel-border bg-panel/60">
          <th
            scope="row"
            colSpan={columnCount - 2}
            className="px-4 py-1.5 text-left font-mono text-xs font-semibold text-muted"
          >
            {formatDate(row.date)}
          </th>
          <td className="px-4 py-1.5 text-right text-xs font-normal text-muted">
            {dayGroup?.showNet && (
              <span
                data-money
                style={dayGroup.net < 0 ? { color: "var(--viz-pos)" } : undefined}
              >
                {roundsToZero(dayGroup.net)
                  ? formatCurrency(0)
                  : `${ledgerNetPrefix(dayGroup.net)}${formatCurrency(Math.abs(dayGroup.net))}`}{" "}
                net
              </span>
            )}
          </td>
          <td />
        </tr>
      )}
      <tr
        className={`border-b border-panel-border last:border-0 hover:bg-panel-hover${
          zebraBand % 2 === 1 ? " bg-panel-2" : ""
        }`}
      >
        <td className="whitespace-nowrap px-4 py-3 align-top text-muted font-mono">
          <span className={grouped && !isNewDay ? "sr-only" : undefined}>
            {formatDate(row.date)}
          </span>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-start gap-2.5">
            <MerchantAvatar
              name={row.merchant || "?"}
              logoUrl={merchantLogoDataUri(row.merchant || "?")}
              size={28}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="font-medium">{merchant}</span>
              {row.pending && (
                <Badge tone="warning" className="ml-2">
                  pending
                </Badge>
              )}
              {cleared && (
                <Badge tone="success" className="ml-2">
                  cleared
                </Badge>
              )}
              {excludedDuplicate && (
                <Badge tone="warning" className="ml-2">
                  Excluded duplicate
                </Badge>
              )}
              {visibleColumns.has("source") && row.source === "manual" && (
                <Badge tone="accent" className="ml-2">
                  manual
                </Badge>
              )}
              {hasAnnotations && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {splits.length > 0 && <Badge tone="accent">split ×{splits.length}</Badge>}
                  {tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                  {note && <span className="text-xs text-muted">{note}</span>}
                </span>
              )}
            </span>
          </div>
        </td>
        {visibleColumns.has("category") && (
          <td className="hidden px-4 py-3 align-top text-muted sm:table-cell">
            {row.category ? <CategoryChip label={titleCase(row.category)} /> : "-"}
          </td>
        )}
        {visibleColumns.has("account") && (
          <td className="hidden px-4 py-3 align-top text-muted md:table-cell">
            {row.accountLabel || "-"}
          </td>
        )}
        <td
          data-money
          className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold"
          style={isMoneyIn ? { color: "var(--viz-pos)" } : undefined}
        >
          {amountDisplay}
        </td>
        <td className="px-2 py-3 text-right align-top">
          <TransactionEditor
            transaction={{ id: row.id, merchant, amount: row.amount, currency }}
            note={note}
            tags={tags}
            splits={splits}
            categories={categoryOptions}
            providerCategory={providerCategory}
            override={override}
            cleared={cleared}
          />
        </td>
      </tr>
    </Fragment>
  );
}

export const metadata = {
  title: "Transactions",
};

export default async function TransactionsPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const state = parseLedgerQuery(params);
  const { month, accountId, q, page, category, sub, merchant, flow, accountType } = state;
  const visibleColumns = state.columns;
  const columnsAreDefault = !state.columnsSubmitted;
  // Gated: manual_account_id/source only exist once
  // 20260730240000_manual_transactions_receipts.sql is applied. /transactions
  // is already live, so this must default to the pre-Phase-12 query shape
  // rather than 500ing every visit on an unmigrated deployment.
  const transactionsParityEnabled = isFeatureEnabled("transactionsParity");

  const supabase = await createClient();
  // The ledger has no household scope selector, so every query below is the
  // caller's own. RLS alone no longer expresses that: `accounts`,
  // `transactions`, and `transaction_splits` are also readable for a household
  // member's opted-in Plaid connections.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = user?.id ?? "";
  const savedViewsResult = await supabase
    .from("saved_views")
    .select("id, name, params")
    .eq("user_id", ownerId)
    .order("created_at");
  const savedViews = ((savedViewsResult.data ?? []) as Array<{
    id: string;
    name: string;
    params: Record<string, string>;
  }>);

  // Fetch accounts and rules first to allow type-based filtration.
  const [accountsResult, manualAccountsResult, merchantRulesResult, goalRowsResult] = await Promise.all([
      supabase.from("accounts").select("id, name, mask, type").eq("user_id", ownerId).order("name"),
      supabase.from("manual_accounts").select("id, name").eq("user_id", ownerId).order("name"),
      supabase
        .from("merchant_rules")
        .select("match_type, pattern, display_name, category, enabled")
        .eq("user_id", ownerId)
        .order("created_at"),
      supabase.from("goals").select("id, name").eq("user_id", ownerId).order("name"),
    ]);

  const accounts = accountsResult.data ?? [];
  const manualAccounts = manualAccountsResult.data ?? [];
  const merchantRules = merchantRulesResult.data ?? [];
  const goalRows = goalRowsResult.data ?? [];
  const setupResults = [
    savedViewsResult.error,
    accountsResult.error,
    manualAccountsResult.error,
    merchantRulesResult.error,
    goalRowsResult.error,
  ].map((error) => ({ error }));
  let ledgerError = transactionSetupError(setupResults);

  const rulesList = (merchantRules ?? []).map((r) => ({
    matchType: r.match_type as "merchant" | "keyword" | "account",
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));

  const { accountNamesById, accountLabelsById, accountOptions } = buildAccountLookups(
    accounts,
    manualAccounts,
  );

  // Merchant rules recategorize/rename rows in-app, so a `category`/`merchant`
  // filter can't be expressed in SQL once such rules exist. In that case fetch
  // the rule-independent scope and filter on the rules-applied values instead.
  const baseColumns = "id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, pfc_detailed, pending, account_id";
  // Typed `: string` rather than left as a literal union: supabase-js parses
  // a literal `.select()` string at the type level to infer the row shape,
  // and a computed union of two literals defeats that parser (ParserError).
  // Widening to `string` falls back to the untyped overload instead, which
  // is what every downstream `as string`/`?? null` read already expects.
  const columns: string = transactionsParityEnabled ? `${baseColumns}, manual_account_id, source` : baseColumns;
  const bounds = month ? monthBounds(month) : null;
  const typedIds = accountType
    ? accounts.filter((account) => account.type === accountType).map((account) => account.id as string)
    : [];
  const missingAccountId = "00000000-0000-0000-0000-000000000000";
  const ledgerChunkFilters: LedgerChunkFilters = {
    bounds,
    ownerId,
    accountId,
    q,
    flow,
    accountType,
    transactionsParityEnabled,
    typedIds,
    missingAccountId,
  };

  const accountOptionsForFilters = accountOptions.map((account) => ({
    value: account.id,
    label: accountLabelsById.get(account.id) ?? account.name,
  }));
  const ledgerRows = await loadLedgerRows({
    supabase,
    state,
    filters: ledgerChunkFilters,
    columns,
    rules: rulesList,
    accountNamesById,
    accountLabelsById,
    accountOptionsForFilters,
    ledgerError,
  });
  const { rows, total, filterOptions } = ledgerRows;
  ledgerError = ledgerRows.ledgerError;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // User annotations (note/tags) and category splits for the visible rows.
  // `transaction_splits` is readable for any transaction the caller can see,
  // which now includes a household member's shared rows — filter to the
  // caller's own so their categories are never rewritten by someone else's.
  const rowDetails = await loadLedgerRowDetails(supabase, ownerId, rows.map((row) => row.id));
  const { annById, overridesById, splitsById, excludedDuplicateIds } = rowDetails;
  ledgerError = transactionDetailsError(ledgerError, rowDetails.failed);

  // Category suggestions for the split editor: categories seen on this page
  // plus any already used in splits.
  const categoryOptions = [
    ...new Set([
      ...rows.map((row) => row.category).filter((value): value is string => Boolean(value)),
      ...[...splitsById.values()].flat().map((s) => s.category),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  // Day-group headers: rows arrive sorted by date desc, so a signed total per
  // date is all a header needs.
  const showDayGroups = shouldShowLedgerDayGroups(state.sort);
  const dayGroups = buildLedgerDayGroups(rows, {
    allRows: ledgerRows.allRowsForGrouping ?? undefined,
    incompleteDates: ledgerRows.incompleteDates,
    excludedIds: excludedDuplicateIds,
  });
  const zebraBands = ledgerZebraBands(rows, showDayGroups);

  const cardRows: LedgerCardRow[] = rows.map((t) => {
    const ann = annById.get(t.id);
    return {
      id: t.id,
      date: t.date,
      merchant: t.merchant || "Unknown",
      category: t.category,
      accountLabel: t.accountLabel || "-",
      amount: t.amount,
      currency: t.iso_currency_code ?? "USD",
      pending: t.pending,
      excludedDuplicate: excludedDuplicateIds.has(t.id),
      note: ann?.note ?? null,
      tags: ann?.tags ?? [],
      splits: splitsById.get(t.id) ?? [],
      categoryOptions,
      providerCategory: t.pfc_primary ?? t.pfc_detailed,
      override: overridesById.get(t.id) ?? null,
      cleared: ann?.cleared ?? false,
    };
  });

  const queryEntries = ledgerQueryEntries(state);
  const pageLink = (nextPage: number) => ledgerHref(
    queryEntries,
    { page: String(nextPage) },
    { resetPage: false },
  );

  const goalOptions = goalRows.map((goal) => ({ id: goal.id as string, name: goal.name as string }));
  const columnsFormParams = Object.fromEntries(
    queryEntries.filter(([key]) => key !== "page" && key !== "col" && key !== "colsSubmitted"),
  ) as Record<string, string>;
  const hasCommittedFilters = hasActiveLedgerFilters(state);
  const showEmptyLedger = !ledgerError && rows.length === 0;
  const showLedgerRows = !ledgerError && rows.length > 0;

  return (
    <AppShell active="transactions" email={user?.email}>
        <AutoRefresh />

        <PageHeader
          title="Transactions"
          actions={
            <>
              <ButtonLink href="/transactions/receipts" variant="secondary">
                Receipts
              </ButtonLink>
              {transactionsParityEnabled && accountOptions.length > 0 && (
                <AddTransactionModal accounts={accountOptions} goals={goalOptions} categories={categoryOptions} />
              )}
            </>
          }
        />

        <RefundReview />
        <TransferReview />
        <DuplicateReview />

        {transactionsParityEnabled && accountOptions.length > 0 && (
          <ScheduledTransactionsSection
            accounts={accountOptions}
            categories={categoryOptions}
          />
        )}

        <SavedViewsBar
          initialViews={savedViews}
          currentParams={savedLedgerViewParams(state)}
        />

        <Panel>
          <TransactionQueryControls
            key={JSON.stringify(queryEntries)}
            committed={{ q, month, accountId, category, sub, merchant, flow, accountType }}
            entries={queryEntries}
            options={filterOptions}
          />
        </Panel>

        {!ledgerError && (
          <p className="text-xs text-muted">
            {total.toLocaleString()} transaction{total === 1 ? "" : "s"}
            {month && bounds ? ` in ${formatMonth(month)}` : ""}. Positive amounts are money out
            (Plaid sign convention).
          </p>
        )}

        {ledgerError && (
          <Panel tone="danger" role="alert" title="Transactions unavailable">
            <p className="text-sm text-muted">{ledgerError}</p>
          </Panel>
        )}
        {showEmptyLedger && (
          <EmptyState
            title={hasCommittedFilters ? "No transactions match these filters" : "No transactions yet"}
            description={
              hasCommittedFilters
                ? "Try changing or clearing the filters."
                : "Connect an account or add a transaction to begin."
            }
          />
        )}
        {showLedgerRows && (
          <Panel padding="none" className="overflow-hidden">
            <TableToolbar
              bulkTagBar={<BulkTagBar transactionIds={rows.map((t) => t.id)} />}
              sortMenu={<TransactionSortMenu key="sort" field={state.sort} direction={state.direction} entries={queryEntries} />}
              columnsMenu={
                transactionsParityEnabled ? (
                  <ColumnsMenu visible={visibleColumns} isDefault={columnsAreDefault} otherParams={columnsFormParams} />
                ) : undefined
              }
            />
            <div className="sm:hidden">
              <MobileLedgerList
                rows={cardRows}
                dayGroups={showDayGroups ? dayGroups : null}
              />
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-panel-2">
                  <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted font-mono">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Merchant</th>
                    {visibleColumns.has("category") && (
                      <th className="hidden px-4 py-3 font-semibold sm:table-cell">Category</th>
                    )}
                    {visibleColumns.has("account") && (
                      <th className="hidden px-4 py-3 font-semibold md:table-cell">Account</th>
                    )}
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      <span className="sr-only">Notes and splits</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((t, index) => (
                    <LedgerTableRow
                      key={t.id}
                      row={t}
                      zebraBand={zebraBands[index]!}
                      isNewDay={showDayGroups && (index === 0 || rows[index - 1]!.date !== t.date)}
                      grouped={showDayGroups}
                      dayGroup={dayGroups.get(t.date)}
                      visibleColumns={visibleColumns}
                      excludedDuplicate={excludedDuplicateIds.has(t.id)}
                      note={annById.get(t.id)?.note ?? null}
                      tags={annById.get(t.id)?.tags ?? []}
                      cleared={annById.get(t.id)?.cleared ?? false}
                      splits={splitsById.get(t.id) ?? []}
                      categoryOptions={categoryOptions}
                      providerCategory={t.pfc_primary ?? t.pfc_detailed}
                      override={overridesById.get(t.id) ?? null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {totalPages > 1 && (
          <nav className="flex items-center justify-between text-sm">
            {page > 1 ? (
              <ButtonLink href={pageLink(page - 1)} variant="secondary">
                Previous
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <ButtonLink href={pageLink(page + 1)} variant="secondary">
                Next
              </ButtonLink>
            ) : (
              <span />
            )}
          </nav>
        )}
    </AppShell>
  );
}
