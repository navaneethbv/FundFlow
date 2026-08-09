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
import CategoryChip from "@/components/ui/CategoryChip";
import { formatCurrency, titleCase, formatMonth } from "@/lib/format";
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
  ledgerDatabaseOrder,
  needsProjectedLedgerPage,
  selectProjectedLedgerPage,
  shouldShowLedgerDayGroups,
} from "@/lib/ledger-data";
import {
  buildLedgerFilterOptions,
  projectLedgerRows,
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
  const setupErrors = [
    savedViewsResult.error,
    accountsResult.error,
    manualAccountsResult.error,
    merchantRulesResult.error,
    goalRowsResult.error,
  ].filter(Boolean);
  let ledgerError = setupErrors.length > 0 ? "We couldn't load your transaction controls. Try again." : "";
  if (setupErrors.length > 0) {
    console.error("Transaction setup query failed", setupErrors.map((error) => error?.code ?? "unknown"));
  }

  const rulesList = (merchantRules ?? []).map((r) => ({
    matchType: r.match_type as "merchant" | "keyword" | "account",
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));

  // A row's resolved account key, whichever of the two FKs is set — a manual
  // transaction (Phase 12) has no `account_id`.
  // Account name without the mask, for rule matching — mirrors the dashboard so
  // the ledger's rules-applied filter agrees with the drill it came from.
  const accountNamesById = new Map([
    ...accounts.map((a) => [a.id as string, (a.name ?? "") as string] as const),
    ...manualAccounts.map((a) => [a.id as string, (a.name ?? "") as string] as const),
  ]);

  const accountLabelsById = new Map([
    ...accounts.map((a) => {
      const mask = a.mask ? ` ••${a.mask}` : "";
      return [a.id as string, `${a.name ?? "Account"}${mask}`] as const;
    }),
    ...manualAccounts.map((a) => [a.id as string, `${a.name ?? "Account"} (manual)`] as const),
  ]);

  const accountOptions = [
    ...accounts.map((a) => ({ id: a.id as string, name: (a.name ?? "Account") as string, source: "plaid" as const })),
    ...manualAccounts.map((a) => ({ id: a.id as string, name: (a.name ?? "Account") as string, source: "manual" as const })),
  ];

  // Merchant rules recategorize/rename rows in-app, so a `category`/`merchant`
  // filter can't be expressed in SQL once such rules exist. In that case fetch
  // the rule-independent scope and filter on the rules-applied values instead.
  const ruleAwareFilter = Boolean(category || merchant) && hasRemapRules(rulesList);

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

  let projectedScope: LedgerProjectedRow[] = [];
  try {
    const sourceRows = await collectLedgerChunks<LedgerProjectionSourceRow>(async (from, to) => {
      let facetQuery = supabase
        .from("transactions")
        .select(columns)
        .eq("user_id", ownerId)
        .order("date", { ascending: false })
        .order("id", { ascending: true });
      if (bounds) facetQuery = facetQuery.gte("date", bounds.start).lte("date", bounds.end);
      if (accountId) {
        facetQuery = transactionsParityEnabled
          ? facetQuery.or(`account_id.eq.${accountId},manual_account_id.eq.${accountId}`)
          : facetQuery.eq("account_id", accountId);
      }
      if (q) {
        const categorySearch = q.replace(/\s+/g, "_");
        facetQuery = facetQuery.or(
          `merchant_name.ilike.%${q}%,name.ilike.%${q}%,pfc_primary.ilike.%${categorySearch}%,pfc_detailed.ilike.%${categorySearch}%`,
        );
      }
      if (flow === "in") facetQuery = facetQuery.lt("amount", 0);
      if (flow === "out") facetQuery = facetQuery.gt("amount", 0);
      if (accountType) facetQuery = facetQuery.in("account_id", typedIds.length ? typedIds : [missingAccountId]);

      const result = await facetQuery.range(from, to);
      return {
        rows: (result.data ?? []) as unknown as LedgerProjectionSourceRow[],
        error: result.error,
      };
    });
    projectedScope = projectLedgerRows(sourceRows, rulesList, accountNamesById, accountLabelsById);
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    console.error("Transaction projection query failed", code);
    ledgerError = "We couldn't load your transactions. Try changing the filters or refresh the page.";
  }

  const projectedPath = needsProjectedLedgerPage(state.sort, ruleAwareFilter);
  let rows: LedgerProjectedRow[] = [];
  let total = 0;
  if (!ledgerError && projectedPath) {
    const selected = selectProjectedLedgerPage(projectedScope, { ...state, pageSize: PAGE_SIZE });
    rows = selected.rows;
    total = selected.total;
  } else if (!ledgerError) {
    let directQuery = supabase
      .from("transactions")
      .select(columns, { count: "exact" })
      .eq("user_id", ownerId);
    if (bounds) directQuery = directQuery.gte("date", bounds.start).lte("date", bounds.end);
    if (accountId) {
      directQuery = transactionsParityEnabled
        ? directQuery.or(`account_id.eq.${accountId},manual_account_id.eq.${accountId}`)
        : directQuery.eq("account_id", accountId);
    }
    if (q) {
      const categorySearch = q.replace(/\s+/g, "_");
      directQuery = directQuery.or(
        `merchant_name.ilike.%${q}%,name.ilike.%${q}%,pfc_primary.ilike.%${categorySearch}%,pfc_detailed.ilike.%${categorySearch}%`,
      );
    }
    if (category) {
      directQuery = category === "UNCATEGORIZED"
        ? directQuery.or("pfc_primary.is.null,pfc_primary.eq.UNCATEGORIZED")
        : directQuery.eq("pfc_primary", category);
    }
    if (sub) directQuery = directQuery.eq("pfc_detailed", sub);
    if (merchant) directQuery = directQuery.or(`merchant_name.ilike.${merchant},name.ilike.${merchant}`);
    if (flow === "in") directQuery = directQuery.lt("amount", 0);
    if (flow === "out") directQuery = directQuery.gt("amount", 0);
    if (accountType) directQuery = directQuery.in("account_id", typedIds.length ? typedIds : [missingAccountId]);
    const databaseSort = state.sort === "amount" ? "amount" : "date";
    for (const order of ledgerDatabaseOrder(databaseSort, state.direction)) {
      directQuery = directQuery.order(order.column, { ascending: order.ascending });
    }
    const offset = (page - 1) * PAGE_SIZE;
    const result = await directQuery.range(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      console.error("Transaction page query failed", result.error.code ?? "unknown");
      ledgerError = "We couldn't load your transactions. Try changing the filters or refresh the page.";
    } else {
      rows = projectLedgerRows(
        (result.data ?? []) as unknown as LedgerProjectionSourceRow[],
        rulesList,
        accountNamesById,
        accountLabelsById,
      );
      total = result.count ?? rows.length;
    }
  }
  const filterOptions = buildLedgerFilterOptions(
    projectedScope,
    accountOptions.map((account) => ({ value: account.id, label: accountLabelsById.get(account.id) ?? account.name })),
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // User annotations (note/tags) and category splits for the visible rows.
  // `transaction_splits` is readable for any transaction the caller can see,
  // which now includes a household member's shared rows — filter to the
  // caller's own so their categories are never rewritten by someone else's.
  const txnIds = rows.map((row) => row.id);
  const [annotationsResult, splitsResult] = txnIds.length
    ? await Promise.all([
        supabase.from("transaction_annotations").select("transaction_id, note, tags").eq("user_id", ownerId).in("transaction_id", txnIds),
        supabase.from("transaction_splits").select("transaction_id, category, amount").eq("user_id", ownerId).in("transaction_id", txnIds),
      ])
    : [
        { data: [] as { transaction_id: string; note: string | null; tags: string[] }[], error: null },
        { data: [] as { transaction_id: string; category: string; amount: number }[], error: null },
      ];
  const annotations = annotationsResult.data;
  const splits = splitsResult.data;
  if (annotationsResult.error || splitsResult.error) {
    console.error("Transaction detail query failed", [annotationsResult.error?.code, splitsResult.error?.code].filter(Boolean));
    ledgerError = "We couldn't load transaction details. Refresh the page to try again.";
  }

  const annById = new Map<string, { note: string | null; tags: string[] }>();
  for (const a of annotations ?? []) {
    annById.set(a.transaction_id as string, { note: a.note as string | null, tags: (a.tags as string[]) ?? [] });
  }
  const splitsById = new Map<string, { category: string; amount: number }[]>();
  for (const s of splits ?? []) {
    const list = splitsById.get(s.transaction_id as string) ?? [];
    list.push({ category: s.category as string, amount: Number(s.amount) });
    splitsById.set(s.transaction_id as string, list);
  }

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
  const dayTotals = new Map<string, number>();
  for (const r of rows) {
    dayTotals.set(r.date as string, (dayTotals.get(r.date as string) ?? 0) + (r.amount as number));
  }
  const showDayGroups = shouldShowLedgerDayGroups(state.sort);

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
      note: ann?.note ?? null,
      tags: ann?.tags ?? [],
      splits: splitsById.get(t.id) ?? [],
      categoryOptions,
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

  return (
    <AppShell active="transactions" email={user?.email}>
        <AutoRefresh />

        <PageHeader
          title="Transactions"
          actions={
            transactionsParityEnabled &&
            accountOptions.length > 0 && (
              <AddTransactionModal accounts={accountOptions} goals={goalOptions} categories={categoryOptions} />
            )
          }
        />

        <RefundReview />

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

        {ledgerError ? (
          <Panel tone="danger" role="alert" title="Transactions unavailable">
            <p className="text-sm text-muted">{ledgerError}</p>
          </Panel>
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasActiveLedgerFilters(state) ? "No transactions match these filters" : "No transactions yet"}
            description={
              hasActiveLedgerFilters(state)
                ? "Try changing or clearing the filters."
                : "Connect an account or add a transaction to begin."
            }
          />
        ) : (
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
              <MobileLedgerList rows={cardRows} />
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-panel-2">
                  <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted">
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
                    const ann = annById.get(t.id as string);
                    const txnSplits = splitsById.get(t.id as string) ?? [];
                    const isNewDay = showDayGroups && (index === 0 || rows[index - 1]!.date !== t.date);
                    const dayTotal = dayTotals.get(t.date as string) ?? 0;
                    const rowColumnCount =
                      4 + (visibleColumns.has("category") ? 1 : 0) + (visibleColumns.has("account") ? 1 : 0);
                    return (
                    <Fragment key={t.id}>
                      {isNewDay && (
                        <tr className="border-b border-panel-border bg-panel/60">
                          <td colSpan={rowColumnCount} className="px-4 py-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted">
                              <span>{formatDate(t.date as string)}</span>
                              <span data-money className="font-normal">
                                {dayTotal < 0 ? "+" : "-"}
                                {formatCurrency(Math.abs(dayTotal))} net
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    <tr
                      className="border-b border-panel-border last:border-0 hover:bg-panel-hover"
                    >
                      <td className="whitespace-nowrap px-4 py-3 align-top text-muted">
                        {formatDate(t.date as string)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-2.5">
                          <MerchantAvatar name={t.merchant || "?"} size={28} className="mt-0.5" />
                          <span className="min-w-0">
                        <span className="font-medium">{t.merchant || "Unknown"}</span>
                        {t.pending && (
                          <Badge tone="warning" className="ml-2">
                            pending
                          </Badge>
                        )}
                        {visibleColumns.has("source") && t.source === "manual" && (
                          <Badge tone="accent" className="ml-2">
                            manual
                          </Badge>
                        )}
                        {(ann?.note || (ann?.tags?.length ?? 0) > 0 || txnSplits.length > 0) && (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {txnSplits.length > 0 && <Badge tone="accent">split ×{txnSplits.length}</Badge>}
                            {ann?.tags?.map((tag) => (
                              <Badge key={tag}>{tag}</Badge>
                            ))}
                            {ann?.note && <span className="text-xs text-muted">{ann.note}</span>}
                          </span>
                        )}
                          </span>
                        </div>
                      </td>
                      {visibleColumns.has("category") && (
                        <td className="hidden px-4 py-3 align-top text-muted sm:table-cell">
                          {t.category ? <CategoryChip label={titleCase(t.category)} /> : "-"}
                        </td>
                      )}
                      {visibleColumns.has("account") && (
                        <td className="hidden px-4 py-3 align-top text-muted md:table-cell">
                          {t.accountLabel || "-"}
                        </td>
                      )}
                      <td
                        data-money
                        className={
                          t.amount < 0
                            ? "whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-success"
                            : "whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-foreground"
                        }
                      >
                        {t.amount < 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(t.amount), t.iso_currency_code ?? "USD")}
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        <TransactionEditor
                          transaction={{
                            id: t.id,
                            merchant: t.merchant || "Unknown",
                            amount: t.amount,
                            currency: t.iso_currency_code ?? "USD",
                          }}
                          note={ann?.note ?? null}
                          tags={ann?.tags ?? []}
                          splits={txnSplits}
                          categories={categoryOptions}
                        />
                      </td>
                    </tr>
                    </Fragment>
                    );
                  })}
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
