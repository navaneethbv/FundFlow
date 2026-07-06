import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import AppShell from "@/components/shell/AppShell";
import { formatCurrency, titleCase, formatMonth } from "@/lib/format";

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
  const [{ data: txns, count }, { data: accounts }] = await Promise.all([
    query.range(offset, offset + PAGE_SIZE - 1),
    supabase.from("accounts").select("id, name, mask").order("name"),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rows = txns ?? [];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const accountName = new Map(
    (accounts ?? []).map((a) => [a.id as string, `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`]),
  );

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
      {/* New transactions appear as the webhook/auto-pull writes them. */}
      <AutoRefresh />

      <header className="flex items-center justify-between border-b border-black/5 pb-3 dark:border-white/5">
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
      </header>

      {/* One filter row above everything it scopes (plain GET form, no JS). */}
      <form
        method="get"
        action="/transactions"
        className="flex flex-wrap items-center gap-2 bg-black/5 dark:bg-white/5 p-3 rounded-2xl text-sm"
      >
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search merchant or category…"
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 flex-1 min-w-40"
        />
        <input
          type="month"
          name="month"
          defaultValue={month}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5"
        />
        <select
          name="accountId"
          defaultValue={accountId}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-1.5 max-w-48"
        >
          <option value="">All accounts</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? "Account"}
              {a.mask ? ` ••${a.mask}` : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-foreground text-background px-4 py-1.5 font-medium"
        >
          Filter
        </button>
        {(month || accountId || params.q) && (
          <Link href="/transactions" className="underline opacity-70">
            Clear
          </Link>
        )}
      </form>

      <p className="text-xs opacity-60">
        {total.toLocaleString()} transaction{total === 1 ? "" : "s"}
        {month && bounds ? ` in ${formatMonth(month)}` : ""} · positive amounts are money out
        (Plaid sign convention)
      </p>

      {rows.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
          <p className="font-semibold">No transactions found</p>
          <p className="text-sm opacity-60 mt-1">Try clearing filters, or hit Refresh on the dashboard.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider opacity-60 border-b border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03]">
                <th className="py-2.5 px-3 font-semibold">Date</th>
                <th className="py-2.5 px-3 font-semibold">Merchant</th>
                <th className="py-2.5 px-3 font-semibold hidden sm:table-cell">Category</th>
                <th className="py-2.5 px-3 font-semibold hidden md:table-cell">Account</th>
                <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                >
                  <td className="py-2 px-3 whitespace-nowrap opacity-80">{t.date}</td>
                  <td className="py-2 px-3">
                    <span className="font-medium">{t.merchant_name ?? t.name ?? "Unknown"}</span>
                    {t.pending && (
                      <span className="ml-2 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        pending
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 hidden sm:table-cell opacity-70">
                    {titleCase(t.pfc_primary) || "-"}
                  </td>
                  <td className="py-2 px-3 hidden md:table-cell opacity-70">
                    {accountName.get(t.account_id) ?? "-"}
                  </td>
                  <td
                    className="py-2 px-3 text-right font-semibold whitespace-nowrap"
                    style={t.amount < 0 ? { color: "var(--viz-good)" } : undefined}
                  >
                    {t.amount < 0 ? "+" : ""}
                    {formatCurrency(Math.abs(t.amount), t.iso_currency_code ?? "USD")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageLink(page - 1)} className="underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="opacity-60">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageLink(page + 1)} className="underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      </div>
    </AppShell>
  );
}
