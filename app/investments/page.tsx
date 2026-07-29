import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { buildInvestmentsPage, type HoldingJoinRow } from "@/lib/investments";
import HoldingsTable from "@/components/investments/HoldingsTable";
import { formatCurrency } from "@/lib/format";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  if (!isFeatureEnabled("investmentsPage")) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch holdings joined with securities & accounts
  const { data: holdingsRows } = await supabase
    .from("holdings")
    .select("id, account_id, manual_account_id, quantity, institution_price, institution_value, source, is_active, securities(ticker, name, security_type)");

interface RawHoldingDbRow {
  id: string;
  account_id: string | null;
  manual_account_id: string | null;
  quantity: number | string | null;
  institution_price: number | string | null;
  institution_value: number | string | null;
  source: "plaid" | "manual";
  is_active: boolean;
  securities: { ticker: string | null; name: string; security_type: string | null } | { ticker: string | null; name: string; security_type: string | null }[] | null;
}

  const holdings: HoldingJoinRow[] = ((holdingsRows as unknown as RawHoldingDbRow[]) || []).map((h) => ({
    id: h.id,
    accountId: h.account_id,
    manualAccountId: h.manual_account_id,
    accountName: "Investment Account",
    securityName: Array.isArray(h.securities) ? h.securities[0]?.name || "Security" : h.securities?.name || "Security",
    ticker: Array.isArray(h.securities) ? h.securities[0]?.ticker || null : h.securities?.ticker || null,
    securityType: Array.isArray(h.securities) ? h.securities[0]?.security_type || "equity" : h.securities?.security_type || "equity",
    quantity: h.quantity ? Number(h.quantity) : null,
    price: h.institution_price ? Number(h.institution_price) : null,
    value: h.institution_value ? Number(h.institution_value) : null,
    source: h.source || "plaid",
    isActive: Boolean(h.is_active),
  }));

  const investmentsData = buildInvestmentsPage(holdings);

  return (
    <AppShell active="investments" email={user.email}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Investments</h1>
          <p className="text-sm text-muted">
            Track portfolio holdings, asset allocation, and market performance
          </p>
        </div>

        {/* Portfolio Summary Card */}
        <div className="rounded-panel border border-panel-border bg-panel p-6">
          <p className="text-xs font-medium text-muted">Total Portfolio Value</p>
          <p className="mt-1 text-3xl font-bold text-foreground">
            {formatCurrency(investmentsData.total)}
          </p>
        </div>

        {/* Asset Class Groupings */}
        {investmentsData.byClass.map((cls) => (
          <div key={cls.label} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{cls.label}</h2>
              <span className="text-sm font-semibold text-foreground">{formatCurrency(cls.subtotal)}</span>
            </div>
            <HoldingsTable holdings={cls.holdings} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
