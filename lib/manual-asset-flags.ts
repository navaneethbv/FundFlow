import { isFeatureEnabled } from "@/lib/feature-flags";

export function manualAssetsEnabled(): boolean {
  return isFeatureEnabled("typedManualAssets") && isFeatureEnabled("assetOwnership") && isFeatureEnabled("historyProvenance");
}

/** Balance reads use the owned valuation; writes and backups retain raw input. */
export function manualBalanceTable(): "manual_accounts" | "manual_account_balances" {
  return manualAssetsEnabled() ? "manual_account_balances" : "manual_accounts";
}
