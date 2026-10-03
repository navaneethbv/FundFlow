import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetInput } from "@/lib/manual-assets";

export interface StoredAsset extends AssetInput { id: string; version: number }

export async function materializeManualAssets(service: SupabaseClient, userId: string, today: string): Promise<Set<string>> {
  const { data, error } = await service.from("manual_assets").select("manual_account_id").eq("user_id", userId).limit(101);
  if (error) throw error;
  if ((data?.length ?? 0) > 100) throw new Error("Too many manual assets to materialize");
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.manual_account_id);
    const result = await service.rpc("materialize_manual_asset", { p_user_id: userId, p_account_id: id, p_today: today });
    if (result.error) throw result.error;
    ids.add(id);
  }
  return ids;
}

export async function loadManualAssets(client: SupabaseClient, userId: string): Promise<StoredAsset[]> {
  const { data, error } = await client.from("manual_assets")
    .select("*,manual_accounts!inner(name)").eq("user_id", userId).order("manual_account_id").limit(101);
  if (error) throw error;
  if ((data?.length ?? 0) > 100) throw new Error("Too many manual assets to display");
  return (data ?? []).map((row) => {
    const account = row.manual_accounts as unknown as { name: string };
    return {
      id: row.manual_account_id, version: row.version, name: account.name, assetKind: row.asset_kind,
      value: Number(row.valuation_value), valuationDate: row.valuation_date, valueSource: row.value_source,
      ownershipPercentage: Number(row.ownership_percentage), purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
      purchaseDate: row.purchase_date,
      growth: row.growth_kind === null ? null : { kind: row.growth_kind, amount: Number(row.growth_amount), period: row.growth_period, startDate: row.growth_start_date },
    } as StoredAsset;
  });
}
