import "server-only";
import { getPlaidClient } from "@/lib/plaid";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptItemToken, listActiveItems } from "@/lib/plaid-service";
import { logError } from "@/lib/log";

/**
 * Automatic card APRs via Plaid's Liabilities product (Bucket 2).
 * Gated by PLAID_LIABILITIES_ENABLED=1 because /liabilities/get is a paid
 * Plaid product add — flipping it on without the product enabled in the
 * Plaid dashboard just logs errors. User-entered APRs are only overwritten
 * by real Plaid values (purchase APR).
 */
export async function syncCardAprsForUser(userId: string): Promise<number> {
  if (process.env.PLAID_LIABILITIES_ENABLED !== "1") return 0;

  const items = await listActiveItems(userId);
  const service = createServiceClient();
  const plaid = getPlaidClient();
  let updated = 0;

  for (const item of items) {
    try {
      const accessToken = decryptItemToken(item);
      const response = await plaid.liabilitiesGet({ access_token: accessToken });
      for (const card of response.data.liabilities?.credit ?? []) {
        if (!card.account_id) continue;
        const purchaseApr = (card.aprs ?? []).find(
          (apr) => apr.apr_type === "purchase_apr",
        )?.apr_percentage;
        if (purchaseApr === undefined || purchaseApr === null) continue;
        const { error } = await service
          .from("accounts")
          .update({ apr: Math.round(Number(purchaseApr) * 100) / 100 })
          .eq("plaid_account_id", card.account_id)
          .eq("user_id", userId);
        if (!error) updated += 1;
      }
    } catch (error) {
      logError("liabilities.item", error);
    }
  }
  return updated;
}
