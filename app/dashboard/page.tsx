import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard";
import { formatCurrency, titleCase, formatMonth } from "@/lib/format";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BarList({
  items,
  max,
}: {
  items: { label: string; amount: number }[];
  max: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm opacity-60">No data yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="text-sm">
          <div className="flex justify-between mb-1">
            <span>{item.label}</span>
            <span className="tabular-nums">{formatCurrency(item.amount)}</span>
          </div>
          <div className="h-1.5 rounded bg-black/10 dark:bg-white/15 overflow-hidden">
            <div
              className="h-full bg-foreground"
              style={{ width: `${max > 0 ? (item.amount / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, { data: items }] = await Promise.all([
    getDashboardData(supabase),
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .order("created_at"),
  ]);

  const net = data.currentMonthIncome - data.currentMonthExpenses;
  const maxCategory = Math.max(1, ...data.categoryBreakdown.map((c) => c.amount));
  const maxMerchant = Math.max(1, ...data.merchantBreakdown.map((m) => m.amount));
  const maxMonth = Math.max(1, ...data.monthlySpending.map((m) => m.amount));
  const hasBanks = (items ?? []).length > 0;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">FundFlow</h1>
        <nav className="flex items-center gap-4 text-sm">
          <span className="opacity-60 hidden sm:inline">{user?.email}</span>
          <Link href="/settings" className="underline">
            Settings
          </Link>
          <LogoutButton />
        </nav>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ConnectBankButton />
        {hasBanks && <RefreshButton />}
        <div className="text-sm opacity-70">
          {(items ?? []).map((i) => (
            <span
              key={i.id}
              className="inline-block mr-2 rounded-full border border-black/10 dark:border-white/15 px-2 py-0.5"
            >
              {i.institution_name ?? "Bank"}
              {i.status !== "active" ? ` (${i.status})` : ""}
            </span>
          ))}
        </div>
      </div>

      {!hasBanks ? (
        <p className="opacity-70">
          Connect a bank to see your spending, income, and subscriptions.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card title="This month · Income">
              <p className="text-2xl font-semibold tabular-nums text-green-600">
                {formatCurrency(data.currentMonthIncome)}
              </p>
            </Card>
            <Card title="This month · Expenses">
              <p className="text-2xl font-semibold tabular-nums text-red-600">
                {formatCurrency(data.currentMonthExpenses)}
              </p>
            </Card>
            <Card title="This month · Net">
              <p
                className={`text-2xl font-semibold tabular-nums ${
                  net >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(net)}
              </p>
            </Card>
          </div>

          <Card title="Accounts & balances">
            <ul className="divide-y divide-black/10 dark:divide-white/10">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex justify-between py-2 text-sm">
                  <span>
                    {a.name ?? "Account"}
                    {a.mask ? ` ••${a.mask}` : ""}
                    <span className="opacity-50">
                      {" "}
                      {titleCase(a.subtype ?? a.type)}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(a.current_balance, a.iso_currency_code ?? "USD")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Monthly spending">
              <BarList
                items={data.monthlySpending.map((m) => ({
                  label: formatMonth(m.month),
                  amount: m.amount,
                }))}
                max={maxMonth}
              />
            </Card>
            <Card title="Spending by category (this month)">
              <BarList
                items={data.categoryBreakdown.map((c) => ({
                  label: titleCase(c.category),
                  amount: c.amount,
                }))}
                max={maxCategory}
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Top merchants (this month)">
              <BarList
                items={data.merchantBreakdown.map((m) => ({
                  label: m.merchant,
                  amount: m.amount,
                }))}
                max={maxMerchant}
              />
            </Card>
            <Card title="Recurring subscriptions">
              {data.subscriptions.length === 0 ? (
                <p className="text-sm opacity-60">None detected yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.subscriptions.map((s, i) => (
                    <li key={i} className="flex justify-between">
                      <span>
                        {s.merchant}
                        <span className="opacity-50">
                          {" "}
                          {titleCase(s.frequency ?? "")}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(s.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </main>
  );
}
