import { notFound } from "next/navigation";
import DebtPlannerView from "@/components/debt/DebtPlannerView";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import SegmentedControl from "@/components/ui/SegmentedControl";
import {
  loadDebtPlannerData,
  parseDebtStrategy,
  parseExtraMonthly,
} from "@/lib/debt-data";
import {
  parseFinancialScope,
  serializeFinancialScope,
} from "@/lib/financial-scope";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    strategy?: string | string[];
    extra?: string | string[];
    scope?: string | string[];
  }>;
}

function scopeHref(
  scope: string | undefined,
  strategy: "avalanche" | "snowball",
  extraMonthly: number,
): string {
  const params = new URLSearchParams({ strategy });
  if (extraMonthly > 0) params.set("extra", String(extraMonthly));
  if (scope) params.set("scope", scope);
  return `/debt?${params.toString()}`;
}

export const metadata = {
  title: "Debt payoff",
};

export default async function DebtPage({ searchParams }: Readonly<PageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: householdRows, error: householdError } = await supabase
    .from("households")
    .select("id");
  if (householdError) throw householdError;
  const visibleHouseholdIds = (householdRows ?? []).map((row) => String(row.id));
  const scope = parseFinancialScope({
    raw: params.scope,
    ownerUserId: user.id,
    visibleHouseholdIds,
  });
  const strategy = parseDebtStrategy(params.strategy);
  const extraMonthly = parseExtraMonthly(params.extra);
  const data = await loadDebtPlannerData(supabase, {
    scope,
    extraMonthly,
  });
  const scopeParam = serializeFinancialScope(scope);

  return (
    <AppShell active="debt" email={user.email}>
      <div className="space-y-6">
        <PageHeader
          title="Debt payoff"
          actions={
            visibleHouseholdIds.length > 0 ? (
              <SegmentedControl
                ariaLabel="Debt account scope"
                items={[
                  {
                    label: "Mine",
                    href: scopeHref(undefined, strategy, extraMonthly),
                    active: scope.kind === "mine",
                  },
                  {
                    label: "Household",
                    href: scopeHref(visibleHouseholdIds[0], strategy, extraMonthly),
                    active: scope.kind === "household",
                  },
                ]}
              />
            ) : undefined
          }
        />
        <DebtPlannerView
          data={data}
          strategy={strategy}
          extraMonthly={extraMonthly}
          scopeParam={scopeParam}
        />
      </div>
    </AppShell>
  );
}
