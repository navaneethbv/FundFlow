import { notFound } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import Panel from "@/components/ui/Panel";
import ManualAssetForm from "@/components/accounts/ManualAssetForm";
import { createClient } from "@/lib/supabase/server";
import { manualAssetsEnabled } from "@/lib/manual-asset-flags";
import { loadManualAssets } from "@/lib/manual-assets-data";
import { resolveViewerToday } from "@/lib/report-period";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manual assets" };

export default async function ManualAssetsPage({ searchParams }: Readonly<{ searchParams: Promise<{ asset?: string }> }>) {
  if (!manualAssetsEnabled()) notFound();
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) notFound();
  const [assets, today, params] = await Promise.all([loadManualAssets(client, user.id), resolveViewerToday(client, user.id), searchParams]);
  const selected = assets.find((asset) => asset.id === params.asset);
  if (params.asset && !selected) notFound();
  const history = selected ? await client.from("manual_account_values").select("id,valuation_date,gross_value,owned_value,provenance,value_source")
    .eq("user_id", user.id).eq("manual_account_id", selected.id).order("valuation_date", { ascending: false }).limit(100) : { data: [], error: null };
  if (history.error) throw history.error;
  return <AppShell active="accounts" email={user.email}><PageHeader title="Manual assets" description="Property, vehicles, and other assets with dated valuations and an explicit owned share." />
    <div className="space-y-6">
      <Panel title="Your assets"><ul className="space-y-2">{assets.map((asset) => <li key={asset.id}><Link className="underline" href={`/accounts/assets?asset=${asset.id}`}>{asset.name}</Link>{" · "}{asset.assetKind}{" · "}{asset.ownershipPercentage}% owned</li>)}</ul>
        {assets.length === 0 && <p>No manual assets yet.</p>}
        {selected && <Link className="mt-4 inline-block underline" href="/accounts/assets">Add another asset</Link>}
      </Panel>
      <Panel title={selected?.name ?? "New asset"}><ManualAssetForm key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`} initial={selected} today={today} /></Panel>
      {selected && <Panel title="Valuation history"><p className="mb-3 text-sm text-muted">Latest 100 entries. Growth is refreshed daily; each date states when the value applies. Entered values are retained.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Full and owned asset valuations with source</caption>
          <thead><tr>{["Date", "Full value", "Owned value", "Source"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody>{history.data?.map((value) => <tr key={value.id}><td className="p-2">{value.valuation_date}</td><td data-money className="p-2">{formatCurrency(Number(value.gross_value))}</td><td data-money className="p-2">{formatCurrency(Number(value.owned_value))}</td><td className="p-2">{value.provenance === "estimated" ? "Estimate" : "Manual"}: {value.value_source}</td></tr>)}</tbody>
        </table></div>
      </Panel>}
    </div>
  </AppShell>;
}
