import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BasisAnnotation, TaxOverride } from "@/lib/investment-provenance";
import type { MortgageTerms, LiabilityObservation } from "@/lib/property-equity";
export class PortfolioReadLimitError extends Error {}

/** Bounded, deterministic owner reads. Never silently return PostgREST's first
 * 1000 rows as a complete financial population. */
export async function portfolioRows<T>(client: SupabaseClient, userId: string, table: string, columns: string, order: string,
  filter?: { column: string; value: string | string[] }) {
  const rows: T[] = [];
  for (let offset = 0; offset <= 10000; offset += 500) {
    let query = client.from(table).select(columns).eq("user_id", userId).order(order);
    if (filter) query = Array.isArray(filter.value) ? query.in(filter.column, filter.value) : query.eq(filter.column, filter.value);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
    if (rows.length > 10000) throw new PortfolioReadLimitError(`Portfolio read limit exceeded: ${table}`);
    if (!data || data.length < 500) return rows;
  }
  return rows;
}
export interface StoredBasis extends BasisAnnotation { holding_id: string; version: number }
export const loadBasisAnnotations = (client: SupabaseClient, user: string) => portfolioRows<StoredBasis>(client, user, "holding_basis_annotations", "holding_id,amount,quantity,source,version", "holding_id");
export const loadTaxOverrides = (client: SupabaseClient, user: string) => portfolioRows<TaxOverride>(client, user, "account_tax_treatments", "account_id,manual_account_id,bucket,version", "id");
export interface BasisRecord { id: string; account_id: string | null; manual_account_id: string | null; quantity: number | null; institution_value: number | null; cost_basis: number | null; is_active: boolean; securities: { name: string; iso_currency_code: string | null } | null }
export const loadBasisHoldings = (client: SupabaseClient, user: string) => portfolioRows<BasisRecord>(client, user, "holdings", "id,account_id,manual_account_id,quantity,institution_value,cost_basis,is_active,securities(name,iso_currency_code)", "id");
export interface StoredMortgage { manual_account_id: string; liability_account_id: string | null; liability_manual_account_id: string | null; terms: MortgageTerms; version: number }
export interface LiabilityOption { id: string; name: string; source: "plaid" | "manual" }
export async function loadMortgageData(client: SupabaseClient, user: string, property: string) {
  const [links, accounts, manual] = await Promise.all([
    portfolioRows<StoredMortgage>(client, user, "property_mortgages", "manual_account_id,liability_account_id,liability_manual_account_id,terms,version", "manual_account_id", { column: "manual_account_id", value: property }),
    portfolioRows<{ id: string; name: string; type: string; iso_currency_code: string | null; current_balance: number | null; updated_at: string }>(client, user, "accounts", "id,name,type,iso_currency_code,current_balance,updated_at", "id"),
    portfolioRows<{ id: string; name: string; account_type: string; balance: number | null; updated_at: string }>(client, user, "manual_accounts", "id,name,account_type,balance,updated_at", "id"),
  ]);
  const options: LiabilityOption[] = [
    ...accounts.filter((a) => a.type === "loan" && a.iso_currency_code === "USD").map((a) => ({ id: a.id, name: a.name, source: "plaid" as const })),
    ...manual.filter((a) => a.account_type === "liability" && a.id !== property).map((a) => ({ id: a.id, name: a.name, source: "manual" as const })),
  ];
  const link = links[0] ?? null;
  const snapshots = link ? await portfolioRows<{ snapshot_date: string; current_balance: number | null; provenance: LiabilityObservation["provenance"] | null }>(client, user,
    "account_balance_snapshots", "id,snapshot_date,current_balance,provenance", "id", { column: link.liability_account_id ? "account_id" : "manual_account_id", value: link.liability_account_id ?? link.liability_manual_account_id! }) : [];
  const observations: LiabilityObservation[] = snapshots.filter((s) => s.current_balance !== null).map((s) => ({ date: s.snapshot_date, balance: Number(s.current_balance), provenance: s.provenance ?? (link?.liability_account_id ? "observed" : "manual") }));
  const account = accounts.find((a) => a.id === link?.liability_account_id);
  const manualAccount = manual.find((a) => a.id === link?.liability_manual_account_id);
  const balance = account ? account.current_balance : manualAccount?.balance;
  const updatedAt = account?.updated_at ?? manualAccount?.updated_at;
  // This date is an explicit UTC capture boundary, not a viewer-relative today.
  const currentObservation: LiabilityObservation | null = balance != null && updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? { date: new Date(updatedAt).toISOString().slice(0, 10), balance: Number(balance), provenance: account ? "observed" : "manual" } : null;
  return { link, options, observations, currentObservation };
}
