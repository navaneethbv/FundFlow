import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import CollectionBudgetForm from "@/components/transactions/CollectionBudgetForm";
import Panel from "@/components/ui/Panel";
import { loadCollections } from "@/lib/collections-data";
import type { CollectionSummary } from "@/lib/collections";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Collections" };

function BudgetStatus({ collection }: Readonly<{ collection: CollectionSummary }>) {
  if (collection.budget === null || collection.remaining === null) return <>None</>;
  const over = collection.remaining < 0;
  return (
    <>
      <span data-money>{formatCurrency(collection.budget)}</span>
      {" · "}
      <span data-money className={over ? "font-semibold text-danger" : undefined}>
        {over ? `${formatCurrency(Math.abs(collection.remaining))} over` : `${formatCurrency(collection.remaining)} left`}
      </span>
    </>
  );
}

/** Reference adoption 6.8: spend grouped across categories by collection tag. */
export default async function CollectionsPage() {
  if (!isFeatureEnabled("transactionCollections")) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const collections = await loadCollections(supabase, user.id);

  return (
    <AppShell active="transactions" email={user.email}>
      <PageHeader title="Collections" />
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Group transactions from any category, like a trip or a renovation. Add them from the transactions list with
        Bulk edit, then Collection. Totals are net spend and exclude transfers and card payments.
      </p>
      {collections.length === 0 ? (
        <Panel title="No collections yet">
          <p className="text-sm text-muted">Select transactions in the ledger and add them to a collection to see them here.</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {collections.map((collection) => (
            <Panel key={collection.name} title={collection.name} eyebrow={`${collection.count} transactions`}>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Spent</dt>
                  <dd data-money className="text-lg font-semibold tabular-nums">{formatCurrency(collection.spent)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Dates</dt>
                  <dd className="tabular-nums">{formatDate(collection.firstDate)} to {formatDate(collection.lastDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Budget</dt>
                  <dd className="tabular-nums"><BudgetStatus collection={collection} /></dd>
                </div>
              </dl>
              <div className="mt-4">
                <CollectionBudgetForm name={collection.name} budget={collection.budget} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </AppShell>
  );
}
