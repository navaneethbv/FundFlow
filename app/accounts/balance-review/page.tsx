import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import BalanceReviewQueue from "@/components/accounts/BalanceReviewQueue";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { loadBalanceReviews } from "@/lib/balance-quality-data";

export const metadata = { title: "Balance review" };
export const dynamic = "force-dynamic";
export default async function BalanceReviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ before?: string }> }>) {
  if (!isFeatureEnabled("balanceQualityReview")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) redirect("/login");
  const { before } = await searchParams;
  if (
    before &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      before,
    )
  )
    notFound();
  const { reviews, next } = await loadBalanceReviews(
    auth.supabase,
    auth.user.id,
    before,
  );
  const ids = [...new Set(reviews.map((review) => review.account_id))];
  const { data, error } = ids.length
    ? await auth.supabase
        .from("accounts")
        .select("id,name")
        .eq("user_id", auth.user.id)
        .in("id", ids)
    : { data: [], error: null };
  if (error) throw error;
  const accounts = Object.fromEntries(
    (data ?? []).map((row) => [row.id as string, row.name as string]),
  );
  return (
    <AppShell active="accounts" email={auth.user.email}>
      <PageHeader
        title="Balance review"
        description="Your provider observations and review decisions"
      />
      <div className="space-y-4">
        <ButtonLink href="/accounts" variant="secondary">
          Back to accounts
        </ButtonLink>
        <BalanceReviewQueue reviews={reviews} accounts={accounts} />
        <nav aria-label="Review pages" className="flex flex-wrap gap-2">
          {before && (
            <ButtonLink href="/accounts/balance-review" variant="secondary">
              First page
            </ButtonLink>
          )}
          {next && (
            <ButtonLink
              href={`/accounts/balance-review?before=${next}`}
              variant="secondary"
            >
              More reviews
            </ButtonLink>
          )}
        </nav>
      </div>
    </AppShell>
  );
}
