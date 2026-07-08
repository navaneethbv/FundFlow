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

  const supabase = await createClient();

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

  const offset = (page - 1) * PAGE_SIZE;
  const [{ data: txns, count }, { data: accounts }, { data: merchantRules }] = await Promise.all([
    query.range(offset, offset + PAGE_SIZE - 1),
    supabase.from("accounts").select("id, name, mask").order("name"),
    supabase.from("merchant_rules").select("match_type, pattern, display_name, category, enabled").order("created_at"),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const accountName = new Map(
    (accounts ?? []).map((a) => [a.id as string, `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`]),
  );

  const rawRows = txns ?? [];
  const total = count ?? rawRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  const pageLink = (p: number) => {
    const parts = [`page=${p}`];
    if (month) parts.push(`month=${month}`);
    if (accountId) parts.push(`accountId=${accountId}`);
    if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
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
            {(month || accountId || params.q) && (
              <ButtonLink href="/transactions" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </form>
        </Panel>

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
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-panel-border last:border-0 hover:bg-panel-hover"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{t.date}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{t.merchant_name ?? t.name ?? "Unknown"}</span>
                        {t.pending && (
                          <Badge tone="warning" className="ml-2">
                            pending
                          </Badge>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-muted sm:table-cell">
                        {titleCase(t.pfc_primary) || "-"}
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {accountName.get(t.account_id) ?? "-"}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3 text-right font-semibold"
                        style={t.amount < 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}
                      >
                        {t.amount < 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(t.amount), t.iso_currency_code ?? "USD")}
                      </td>
                    </tr>
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
