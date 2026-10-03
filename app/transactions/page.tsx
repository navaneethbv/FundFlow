import {
  LEDGER_PAGE_SIZE as PAGE_SIZE, buildAccountLookups, loadLedgerRows, loadLedgerRowDetails,
  type LedgerChunkFilters,
} from "./_lib/ledger-page-data";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import RefundReview from "@/components/transactions/RefundReview";
import DuplicateReview from "@/components/transactions/DuplicateReview";
import ScheduledTransactionsSection from "@/components/transactions/ScheduledTransactionsSection";
import TransferReview from "@/components/transactions/TransferReview";
import LedgerTableRow from "@/components/transactions/LedgerTableRow";
import MobileLedgerList, { type LedgerCardRow } from "@/components/transactions/MobileLedgerList";
import SavedViewsBar from "@/components/transactions/SavedViewsBar";
import BulkTagBar from "@/components/transactions/BulkTagBar";
import BulkEditBar from "@/components/transactions/BulkEditBar";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import TransactionCalendar from "@/components/transactions/TransactionCalendar";
import ProjectedLedgerSection, { type ProjectedLedgerItem } from "@/components/transactions/ProjectedLedgerSection";
import BayesCategorizeButton from "@/components/transactions/BayesCategorizeButton";
import ColumnsMenu from "@/components/transactions/ColumnsMenu";
import TableToolbar from "@/components/transactions/TableToolbar";
import LedgerKeyboardNavigation from "@/components/transactions/LedgerKeyboardNavigation";
import TransactionQueryControls from "@/components/transactions/TransactionQueryControls";
import TransactionSortMenu from "@/components/transactions/TransactionSortMenu";
import { formatMonth } from "@/lib/format";
import {
  hasActiveLedgerFilters,
  ledgerHref,
  ledgerQueryEntries,
  parseLedgerQuery,
  savedLedgerViewParams,
  type LedgerRawSearchParams,
  type LedgerQueryState,
  type LedgerReviewFilter,
} from "@/lib/ledger-query";
import {
  ledgerZebraBands,
  buildLedgerDayGroups,
  shouldShowLedgerDayGroups,
} from "@/lib/ledger-data";
import {
  type LedgerProjectedRow,
  type LedgerProjectionSourceRow,
} from "@/lib/ledger-projection";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { buildPlaidCategoryMap } from "@/lib/plaid-category-mapping";
import {
  TransactionReviewScope,
} from "@/components/transactions/TransactionReviewProvider";
import {
  TransactionReviewBulkStrip,
  TransactionReviewFeedback,
} from "@/components/transactions/TransactionReviewControls";
import { isEligibleForReview } from "@/lib/transaction-review";
import { resolveViewerToday } from "@/lib/report-period";

/**
 * Whether a ledger row can be reviewed. The `transaction_review_ledger` view
 * already computes `review_eligible`; the pending/excluded fallback only
 * matters when review is disabled and those columns are absent.
 */
function reviewRowEligible(
  row: Pick<LedgerProjectionSourceRow, "pending" | "review_eligible" | "review_state_missing">,
  isExcluded: boolean,
): boolean {
  return isEligibleForReview({
    pending: row.pending,
    excludedDuplicate: isExcluded,
    review_eligible: row.review_eligible,
    review_state_missing: row.review_state_missing,
  });
}

export const dynamic = "force-dynamic";

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

export const metadata = {
  title: "Transactions",
};

function resolveDateBounds(
  month?: string,
  year?: string,
  day?: string,
): { start: string; end: string } | null {
  if (day) return { start: day, end: day };
  if (month) return monthBounds(month);
  if (year) return { start: `${year}-01-01`, end: `${year}-12-31` };
  return null;
}

function describeLedgerPeriod(
  month?: string,
  year?: string,
  day?: string,
  hasBounds?: boolean,
): string {
  if (!hasBounds) return "";
  if (day) return ` on ${day}`;
  if (month) return ` in ${formatMonth(month)}`;
  if (year) return ` in ${year}`;
  return "";
}

function buildLedgerCardRows(
  rows: LedgerProjectedRow[],
  details: {
    annById: Awaited<ReturnType<typeof loadLedgerRowDetails>>["annById"];
    overridesById: Awaited<ReturnType<typeof loadLedgerRowDetails>>["overridesById"];
    splitsById: Awaited<ReturnType<typeof loadLedgerRowDetails>>["splitsById"];
    excludedDuplicateIds: Set<string>;
    categoryOptions: string[];
  },
): LedgerCardRow[] {
  return rows.map((t) => {
    const ann = details.annById.get(t.id);
    const isExcluded = details.excludedDuplicateIds.has(t.id);
    const eligible = reviewRowEligible(t, isExcluded);

    return {
      id: t.id,
      date: t.date,
      merchant: t.merchant || "Unknown",
      category: t.category,
      accountLabel: t.accountLabel || "-",
      amount: t.amount,
      currency: t.iso_currency_code ?? "USD",
      pending: t.pending,
      excludedDuplicate: isExcluded,
      note: ann?.note ?? null,
      tags: ann?.tags ?? [],
      splits: details.splitsById.get(t.id) ?? [],
      categoryOptions: details.categoryOptions,
      providerCategory: t.pfc_primary ?? t.pfc_detailed,
      override: details.overridesById.get(t.id) ?? null,
      cleared: ann?.cleared ?? false,
      reviewStatus: t.review_status ?? null,
      reviewVersion: t.review_version != null ? String(t.review_version) : null,
      reviewedAt: t.reviewed_at ?? null,
      reviewEligible: eligible,
      reviewStateMissing: Boolean(t.review_state_missing),
    };
  });
}

async function loadReviewSummary(supabase: TransactionsSupabase, ownerId: string, enabled: boolean) {
  if (!enabled) return { count: null, integrityError: "", queryErrors: [] as Array<{ error: { code?: string } | null }> };
  const [queue, missing] = await Promise.all([
    supabase.from("transaction_review_ledger").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("review_status", "needs_review").eq("review_eligible", true),
    supabase.from("transaction_review_ledger").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("review_state_missing", true),
  ]);
  const incomplete = Boolean(missing.error) || (missing.count ?? 0) > 0;
  if (incomplete) console.error("Transaction review state incomplete", { code: missing.error?.code ?? "REVIEW_STATE_MISSING", count: missing.count });
  return {
    count: incomplete || queue.error ? null : queue.count,
    integrityError: incomplete ? "We couldn't verify transaction review status. Refresh the page to try again." : "",
    queryErrors: [{ error: queue.error }, { error: missing.error }],
  };
}

function ledgerEmptyMessage(review: LedgerReviewFilter, globalCount: number | null, filtered: boolean) {
  if (review === "needs_review") {
    if (globalCount === 0) return { title: "You're all caught up", description: "Every posted transaction has been reviewed." };
    return { title: "No transactions need review with these filters", description: "Try changing or clearing the filters." };
  }
  if (review === "reviewed") return { title: "No reviewed transactions match these filters", description: "Review an entry or change the filters." };
  if (filtered) return { title: "No transactions match these filters", description: "Try changing or clearing the filters." };
  return { title: "No transactions yet", description: "Connect an account or add a transaction to begin." };
}

function ledgerColumns(transactionsParityEnabled: boolean, transactionReviewEnabled: boolean): string {
  let columns = "id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, pfc_detailed, pending, account_id";
  if (transactionsParityEnabled) columns += ", manual_account_id, source";
  if (transactionReviewEnabled) columns += ", review_status, review_version, reviewed_at, review_eligible, review_state_missing";
  return columns;
}

async function loadCategoryMappings(supabase: TransactionsSupabase, ownerId: string, enabled: boolean) {
  if (!enabled) return { data: [], error: null };
  return supabase.from("plaid_category_mappings").select("pfc_detailed,display_category")
    .eq("user_id", ownerId).order("pfc_detailed");
}

async function loadProjectedItems(supabase: TransactionsSupabase, ownerId: string, today: string, enabled: boolean): Promise<ProjectedLedgerItem[]> {
  if (!enabled) return [];
  const { data } = await supabase.from("scheduled_transactions").select("id,scheduled_date,merchant,amount,kind")
    .eq("user_id", ownerId).eq("status", "scheduled").gte("scheduled_date", today).order("scheduled_date").limit(50);
  return ((data ?? []) as Array<{ id: string; scheduled_date: string; merchant: string; amount: number | string; kind: "debit" | "credit" }>).map((row) => ({
    id: row.id,
    date: row.scheduled_date,
    merchant: row.merchant,
    amount: Math.abs(Number(row.amount)),
    kind: row.kind,
  }));
}

function redirectInvalidLedgerPage(state: LedgerQueryState, ledgerError: string, totalPages: number): void {
  if (ledgerError || state.page <= totalPages) return;
  redirect(ledgerHref(ledgerQueryEntries(state), { page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false }));
}

export default async function TransactionsPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const transactionReviewEnabled = isFeatureEnabled("transactionReview");
  const transactionCalendarEnabled = isFeatureEnabled("transactionCalendar");
  const projectedLedgerEnabled = isFeatureEnabled("projectedLedgerRows");
  const state = parseLedgerQuery(transactionReviewEnabled ? params : { ...params, review: "all" });
  const { month, day, accountId, q, page, category, sub, merchant, flow, accountType } = state;
  const visibleColumns = state.columns;
  const columnsAreDefault = !state.columnsSubmitted;
  // Gated: manual_account_id/source only exist once
  // 20260730240000_manual_transactions_receipts.sql is applied. /transactions
  // is already live, so this must default to the pre-Phase-12 query shape
  // rather than 500ing every visit on an unmigrated deployment.
  const transactionsParityEnabled = isFeatureEnabled("transactionsParity");
  const plaidCategoryMappingsEnabled = isFeatureEnabled("plaidCategoryMappings");

  const supabase = await createClient();
  // The ledger has no household scope selector, so every query below is the
  // caller's own. RLS alone no longer expresses that: `accounts`,
  // `transactions`, and `transaction_splits` are also readable for a household
  // member's opted-in Plaid connections.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerId = user?.id ?? "";

  const [savedViewsResult, reviewSummary] = await Promise.all([
    supabase
      .from("saved_views")
      .select("id, name, params")
      .eq("user_id", ownerId)
      .order("created_at"),
    loadReviewSummary(supabase, ownerId, transactionReviewEnabled),
  ]);
  const categoryMappingResult = await loadCategoryMappings(supabase, ownerId, plaidCategoryMappingsEnabled);
  const categoryMappings = buildPlaidCategoryMap((categoryMappingResult.data ?? []).map((row) => ({ pfcDetailed: row.pfc_detailed as string, displayCategory: row.display_category as string })));
  const savedViews = ((savedViewsResult.data ?? []) as Array<{
    id: string;
    name: string;
    params: Record<string, string>;
  }>);
  const needsReviewGlobalCount = reviewSummary.count;

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
  const setupResults = [...reviewSummary.queryErrors, ...[
    savedViewsResult.error,

    accountsResult.error,
    manualAccountsResult.error,
    merchantRulesResult.error,
    goalRowsResult.error,
    categoryMappingResult.error,
  ].map((error) => ({ error }))];
  let ledgerError = reviewSummary.integrityError || transactionSetupError(setupResults);


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
  const columns = ledgerColumns(transactionsParityEnabled, transactionReviewEnabled);
  const viewerToday = await resolveViewerToday(supabase, ownerId);
  const calendarMonth = month || viewerToday.slice(0, 7);
  const effectiveMonth = state.view === "calendar" ? calendarMonth : month;
  const bounds = resolveDateBounds(effectiveMonth, state.year, day);
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
    transactionReviewEnabled,
    reviewFilter: state.review,
    typedIds,
    missingAccountId,
  };

  const accountOptionsForFilters = accountOptions.map((account) => ({
    value: account.id,
    label: accountLabelsById.get(account.id) ?? account.name,
  }));
  const projectedItems = await loadProjectedItems(supabase, ownerId, viewerToday, projectedLedgerEnabled);
  const ledgerRows = await loadLedgerRows({
    supabase,
    state,
    filters: ledgerChunkFilters,
    columns,
    rules: rulesList,
    accountNamesById,
    accountLabelsById,
    accountOptionsForFilters,
    categoryMappings,
    ledgerError,
  });
  const { rows, total, filterOptions } = ledgerRows;
  ledgerError = ledgerRows.ledgerError;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  redirectInvalidLedgerPage(state, ledgerError, totalPages);

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

  const cardRows = buildLedgerCardRows(rows, {
    annById,
    overridesById,
    splitsById,
    excludedDuplicateIds,
    categoryOptions,
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
  const hasCommittedFilters = hasActiveLedgerFilters({ ...state, review: "all" });
  const reviewSelectionScope = JSON.stringify([queryEntries, rows.map((row) => [row.id, row.review_version, row.review_eligible, row.review_state_missing])]);
  const showEmptyLedger = !ledgerError && rows.length === 0;
  const showLedgerRows = !ledgerError && rows.length > 0;

  return (
    <AppShell active="transactions" email={user?.email}>
        <TransactionReviewScope selectionScope={reviewSelectionScope} revision={crypto.randomUUID()} authoritative={!ledgerError} ownerId={ownerId} />
        <AutoRefresh />


        <PageHeader
          title="Transactions"
          actions={
            <>
              {isFeatureEnabled("merchantsPage") && <ButtonLink href="/merchants" variant="secondary">Merchants</ButtonLink>}
              {isFeatureEnabled("bayesCategorization") && <BayesCategorizeButton />}
              <ButtonLink href="/transactions/receipts" variant="secondary">
                Receipts
              </ButtonLink>
              {transactionsParityEnabled && accountOptions.length > 0 && (
                <AddTransactionModal
                  accounts={accountOptions}
                  goals={goalOptions}
                  categories={categoryOptions}
                  quickAddEnabled={isFeatureEnabled("quickAddTransaction")}
                />
              )}
            </>
          }
        />

        <RefundReview />
        <TransferReview />
        <DuplicateReview />

        {projectedLedgerEnabled && <ProjectedLedgerSection items={projectedItems} />}

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

        {transactionCalendarEnabled && (
          <nav aria-label="Transaction view" className="flex flex-wrap gap-2">
            <ButtonLink href={ledgerHref(queryEntries, { view: null })} variant={state.view === "list" ? "primary" : "secondary"}>List</ButtonLink>
            <ButtonLink href={ledgerHref(queryEntries, { view: "calendar" })} variant={state.view === "calendar" ? "primary" : "secondary"}>Calendar</ButtonLink>
          </nav>
        )}

        <Panel>
          <TransactionQueryControls
            key={JSON.stringify(queryEntries)}
            committed={{ q, month, accountId, category, sub, merchant, flow, accountType, review: state.review }}
            entries={queryEntries}
            options={filterOptions}
            reviewEnabled={transactionReviewEnabled}
            needsReviewGlobalCount={needsReviewGlobalCount}
          />
        </Panel>

        {transactionReviewEnabled && (
          <>
            <h2 id="transaction-review-heading" tabIndex={-1} className="text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Transaction review</h2>
            <TransactionReviewFeedback />
          </>
        )}

        {!ledgerError && (
          <p className="text-xs text-muted">
            {total.toLocaleString()} transaction{total === 1 ? "" : "s"}
            {describeLedgerPeriod(effectiveMonth, state.year, day, Boolean(bounds))}
            . Negative amounts represent expenses; positive amounts represent income.
          </p>
        )}

        {ledgerError && (
          <Panel tone="danger" role="alert" title="Transactions unavailable">
            <p className="text-sm text-muted">{ledgerError}</p>
            <ButtonLink href={ledgerHref(queryEntries, {}, { resetPage: false })} variant="secondary">Retry</ButtonLink>
          </Panel>
        )}
        {showEmptyLedger && (
          <EmptyState
            {...ledgerEmptyMessage(state.review, needsReviewGlobalCount, hasCommittedFilters)}
            action={hasCommittedFilters && <ButtonLink href="/transactions" variant="secondary">Clear filters</ButtonLink>}
          />
        )}
        {transactionCalendarEnabled && state.view === "calendar" && !ledgerError && (
          <TransactionCalendar
            month={calendarMonth}
            rows={(ledgerRows.projectedScope.length > 0 ? ledgerRows.projectedScope : rows).map((row) => ({
              id: row.id,
              date: row.date,
              amount: row.amount,
              merchant: row.merchant,
            }))}
          />
        )}
        {showLedgerRows && state.view !== "calendar" && (

            <Panel padding="none" className="overflow-hidden">
              {transactionReviewEnabled && (
                <TransactionReviewBulkStrip
                  eligibleRows={rows
                    .filter((t) => reviewRowEligible(t, excludedDuplicateIds.has(t.id)))
                    .map((t) => ({
                      id: t.id,
                      version: t.review_version != null ? String(t.review_version) : "1",
                    }))}
                />
              )}
              <LedgerKeyboardNavigation enabled={isFeatureEnabled("ledgerKeyboardNavigation")}>
              <TableToolbar
                bulkTagBar={<BulkTagBar transactionIds={rows.map((t) => t.id)} />}
                bulkEditBar={<BulkEditBar enabled={isFeatureEnabled("bulkEdit")} />}
                bulkEditEnabled={isFeatureEnabled("bulkEdit")}
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
                  reviewEnabled={transactionReviewEnabled}
                  bulkEditEnabled={isFeatureEnabled("bulkEdit")}
                  undoEnabled={isFeatureEnabled("undoToasts")}
                />
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-panel-2">
                    <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted tabular-nums">
                      {transactionReviewEnabled && (
                        <th className="w-10 px-3 py-3 text-center">
                          <span className="sr-only">Select</span>
                        </th>
                      )}
                      {isFeatureEnabled("bulkEdit") && (
                        <th className="w-10 px-3 py-3 text-center"><span className="sr-only">Select</span></th>
                      )}
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
                    {rows.map((t, index) => {
                      const isExcluded = excludedDuplicateIds.has(t.id);
                      const eligible = reviewRowEligible(t, isExcluded);
                      return (
                        <LedgerTableRow
                          key={t.id}
                          row={t}
                          zebraBand={zebraBands[index]!}
                          isNewDay={showDayGroups && (index === 0 || rows[index - 1]!.date !== t.date)}
                          grouped={showDayGroups}
                          dayGroup={dayGroups.get(t.date)}
                          visibleColumns={visibleColumns}
                          excludedDuplicate={isExcluded}
                          note={annById.get(t.id)?.note ?? null}
                          tags={annById.get(t.id)?.tags ?? []}
                          cleared={annById.get(t.id)?.cleared ?? false}
                          splits={splitsById.get(t.id) ?? []}
                          categoryOptions={categoryOptions}
                          providerCategory={t.pfc_primary ?? t.pfc_detailed}
                          override={overridesById.get(t.id) ?? null}
                          reviewEnabled={transactionReviewEnabled}
                          reviewStatus={t.review_status ?? null}
                          reviewVersion={t.review_version != null ? String(t.review_version) : null}
                          reviewEligible={eligible}
                          reviewStateMissing={Boolean(t.review_state_missing)}
                          bulkEditEnabled={isFeatureEnabled("bulkEdit")}
                          keyboardEnabled={isFeatureEnabled("ledgerKeyboardNavigation")}
                          undoEnabled={isFeatureEnabled("undoToasts")}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </LedgerKeyboardNavigation>
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
