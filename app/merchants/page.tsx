import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import MerchantDirectory from "@/components/merchants/MerchantDirectory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { buildMerchantDirectory, type MerchantSourceRow } from "@/lib/merchant-directory";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Merchants" };

export default async function MerchantsPage() {
  if (!isFeatureEnabled("merchantsPage")) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data, error } = await supabase.from("transactions").select("id,merchant_name,name,amount,date,pfc_primary").eq("user_id", user.id).order("date", { ascending: false }).limit(5000);
  if (error) throw error;
  return <AppShell active="transactions" email={user.email}><PageHeader title="Merchants" /><MerchantDirectory initialRows={buildMerchantDirectory((data ?? []) as MerchantSourceRow[])} /></AppShell>;
}
