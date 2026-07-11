import { createClient } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import AppShell from "@/components/shell/AppShell";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { Search } from "@/components/ui/icons";
import RefundReview from "@/components/transactions/RefundReview";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import { formatCurrency, titleCase, formatMonth } from "@/lib/format";
import { applyMerchantRules } from "@/lib/planning";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    month?: string;
    accountId?: string;
    q?: string;
    page?: string;
    category?: string;
    sub?: string;
    merchant?: string;
    flow?: string;
    accountType?: string;
  }>;
}

function monthBounds(month: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** Strip characters that carry meaning in PostgREST filter syntax. */
function sanitizeSearch(q: string): string {
  return q.replace(/[%_,()."\\]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = params.month ?? "";
  const accountId = params.accountId ?? "";
  const q = sanitizeSearch(params.q ?? "");
  const page = Math.max(1, Number(params.page) || 1);

  const CATEGORY_RE = /^[A-Z][A-Z0-9_]*$/;
  const category = CATEGORY_RE.test(params.category ?? "") ? params.category! : "";
  const sub = CATEGORY_RE.test(params.sub ?? "") ? params.sub! : "";
  const merchant = sanitizeSearch(params.merchant ?? "");
  const flow = params.flow === "in" || params.flow === "out" ? params.flow : "";
  const accountType =
    params.accountType === "depository" || params.accountType === "credit"
      ? params.accountType
      : "";

  const supabase = await createClient();

  // Fetch accounts and rules first to allow type-based filtration.
  const [{ data: accounts }, { data: merchantRules }] = await Promise.all([
    supabase.from("accounts").select("id, name, mask, type").order("name"),
    supabase.from("merchant_rules").select("match_type, pattern, display_name, category, enabled").order("created_at"),
  ]);

  // RLS scopes both queries to the signed-in user.
  let query = supabase
    .from("transactions")
    .select(
      "id, date, amount, iso_currency_code, merchant_name, name, pfc_primary, pending, account_id",
      { count: "exact" },
    )
    .order("date", { ascending: false })
    .order("id", { ascending: true });

  const bounds = month ? monthBounds(month) : null;
  if (bounds) {
    query = query.gte("date", bounds.start).lte("date", bounds.end);
  }
  if (accountId) {
    query = query.eq("account_id", accountId);
  }
  if (q) {
    // Match merchant, raw name, or category (e.g. "food", "travel").
    const catQ = q.replace(/\s+/g, "_"); // categories are SNAKE_CASE
    query = query.or(
      `merchant_name.ilike.%${q}%,name.ilike.%${q}%,pfc_primary.ilike.%${catQ}%,pfc_detailed.ilike.%${catQ}%`,
    );
  }
  if (category) query = query.eq("pfc_primary", category);
  if (sub) query = query.eq("pfc_detailed", sub);
  if (merchant) {
    query = query.or(`merchant_name.ilike.${merchant},name.ilike.${merchant}`);
  }
  if (flow === "in") query = query.lt("amount", 0);
  if (flow === "out") query = query.gt("amount", 0);
  if (accountType) {
    const typedIds = (accounts ?? [])
      .filter((a) => a.type === accountType)
      .map((a) => a.id as string);
    query = query.in("account_id", typedIds.length ? typedIds : ["-"]);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const { data: txns, count } = await query.range(offset, offset + PAGE_SIZE - 1);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const accountName = new Map(
    (accounts ?? []).map((a) => [a.id as string, `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`]),
  );

  const rawRows = txns ?? [];
  const total = count ?? rawRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // User annotations (note/tags) and category splits for the visible rows. RLS
  // scopes both to the signed-in user.
  const txnIds = rawRows.map((r) => r.id as string);
  const [{ data: annotations }, { data: splits }] = txnIds.length
    ? await Promise.all([
        supabase.from("transaction_annotations").select("transaction_id, note, tags").in("transaction_id", txnIds),
        supabase.from("transaction_splits").select("transaction_id, category, amount").in("transaction_id", txnIds),
      ])
    : [{ data: [] as { transaction_id: string; note: string | null; tags: string[] }[] }, { data: [] as { transaction_id: string; category: string; amount: number }[] }];

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

  const cleanupTxns = rawRows.map((r) => ({
    id: r.id,
    merchant: r.merchant_name ?? r.name ?? "",
    category: r.pfc_primary,
    accountName: accountName.get(r.account_id) || "",
  }));

  const rulesList = (merchantRules ?? []).map((r) => ({
    matchType: r.match_type as "merchant" | "keyword" | "account",
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));

  const appliedTxns = applyMerchantRules(cleanupTxns, rulesList);

  const rows = rawRows.map((r, index) => {
    const clean = appliedTxns[index]!;
    return {
      ...r,
      merchant_name: clean.merchant,
      pfc_primary: clean.category,
    };
  });

  // Category suggestions for the split editor: categories seen on this page
  // plus any already used in splits.
  const categoryOptions = [
    ...new Set([
      ...rows.map((r) => r.pfc_primary).filter((c): c is string => Boolean(c)),
      ...[...splitsById.values()].flat().map((s) => s.category),
    ]),
  ].sort();

  const pageLink = (p: number) => {
    const parts = [`page=${p}`];
    if (month) parts.push(`month=${month}`);
    if (accountId) parts.push(`accountId=${accountId}`);
    if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
    if (category) parts.push(`category=${category}`);
    if (sub) parts.push(`sub=${sub}`);
    if (merchant) parts.push(`merchant=${encodeURIComponent(merchant)}`);
    if (flow) parts.push(`flow=${flow}`);
    if (accountType) parts.push(`accountType=${accountType}`);
    return `/transactions?${parts.join("&")}`;
  };

  return (
    <AppShell active="transactions" email={user?.email}>
      <div className="mx-auto max-w-4xl space-y-5">
        <AutoRefresh />

        <header>
          <p className="eyebrow">Ledger</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Transactions</h1>
        </header>

        <RefundReview />

        <Panel>
          <form method="get" action="/transactions" className="flex flex-wrap items-center gap-2 text-sm">
            <div className="relative min-w-52 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <Input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Search transactions"
                className="pl-9"
              />
            </div>
            <Input type="month" name="month" defaultValue={month} className="w-auto" />
            <Select name="accountId" defaultValue={accountId} className="max-w-52">
              <option value="">All accounts</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? "Account"}
                  {a.mask ? ` **${a.mask}` : ""}
                </option>
              ))}
            </Select>
            <Button type="submit">Filters</Button>
            {(month || accountId || params.q || category || sub || merchant || flow || accountType) && (
              <ButtonLink href="/transactions" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </form>
        </Panel>

        {(category || sub || merchant || flow || accountType) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(
              [
                ["category", category ? titleCase(category) : ""],
                ["sub", sub ? titleCase(sub) : ""],
                ["merchant", merchant],
                ["flow", flow === "in" ? "Money in" : flow === "out" ? "Money out" : ""],
                ["accountType", accountType ? titleCase(accountType) : ""],
              ] as const
            )
              .filter(([, label]) => label)
              .map(([key, label]) => {
                const remaining = new URLSearchParams();
                if (month) remaining.set("month", month);
                if (accountId) remaining.set("accountId", accountId);
                if (params.q) remaining.set("q", params.q);
                if (category && key !== "category") remaining.set("category", category);
                if (sub && key !== "sub" && key !== "category") remaining.set("sub", sub);
                if (merchant && key !== "merchant") remaining.set("merchant", merchant);
                if (flow && key !== "flow") remaining.set("flow", flow);
                if (accountType && key !== "accountType") remaining.set("accountType", accountType);
                return (
                  <ButtonLink key={key} href={`/transactions?${remaining.toString()}`} variant="ghost">
                    {label} ×
                  </ButtonLink>
                );
              })}
          </div>
        )}

        <p className="text-xs text-muted">
          {total.toLocaleString()} transaction{total === 1 ? "" : "s"}
          {month && bounds ? ` in ${formatMonth(month)}` : ""}. Positive amounts are money out
          (Plaid sign convention).
        </p>

        {rows.length === 0 ? (
          <EmptyState
            title="No transactions found"
            description="Try clearing filters, or refresh from the dashboard."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-panel-2">
                  <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Merchant</th>
                    <th className="hidden px-4 py-3 font-semibold sm:table-cell">Category</th>
                    <th className="hidden px-4 py-3 font-semibold md:table-cell">Account</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      <span className="sr-only">Notes and splits</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((t) => {
                    const ann = annById.get(t.id as string);
                    const txnSplits = splitsById.get(t.id as string) ?? [];
                    return (
                    <tr
                      key={t.id}
                      className="border-b border-panel-border last:border-0 hover:bg-panel-hover"
                    >
                      <td className="whitespace-nowrap px-4 py-3 align-top text-muted">{t.date}</td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-medium">{t.merchant_name ?? t.name ?? "Unknown"}</span>
                        {t.pending && (
                          <Badge tone="warning" className="ml-2">
                            pending
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
                      </td>
                      <td className="hidden px-4 py-3 align-top text-muted sm:table-cell">
                        {titleCase(t.pfc_primary) || "-"}
                      </td>
                      <td className="hidden px-4 py-3 align-top text-muted md:table-cell">
                        {accountName.get(t.account_id) ?? "-"}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold"
                        style={t.amount < 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}
                      >
                        {t.amount < 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(t.amount), t.iso_currency_code ?? "USD")}
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        <TransactionEditor
                          transaction={{
                            id: t.id as string,
                            merchant: (t.merchant_name ?? t.name ?? "Unknown") as string,
                            amount: t.amount as number,
                            currency: (t.iso_currency_code ?? "USD") as string,
                          }}
                          note={ann?.note ?? null}
                          tags={ann?.tags ?? []}
                          splits={txnSplits}
                          categories={categoryOptions}
                        />
                      </td>
                    </tr>
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
                Newer
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <ButtonLink href={pageLink(page + 1)} variant="secondary">
                Older
              </ButtonLink>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </AppShell>
  );
}
