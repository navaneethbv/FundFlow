import { NextResponse, type NextRequest } from "next/server";
import { CountryCode } from "plaid";
import { errorResponse } from "@/lib/http";
import { setItemStatus, updateItemBranding, decryptItemToken } from "@/lib/plaid-service";
import { requireOwnedItem } from "@/lib/plaid-item-route";
import { syncItemTransactions } from "@/lib/sync";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getPlaidClient } from "@/lib/plaid";
import { fetchInstitutionBranding } from "@/lib/plaid-institution";
import { serverEnv } from "@/lib/env.server";

/**
 * Finalize a Plaid Link update-mode flow. Update mode repairs the item's
 * existing access token in place (nothing to exchange), so all that's left is
 * clearing our error state and catching up on transactions. Ownership is
 * enforced by getItem's user_id scope.
 */
export async function POST(request: NextRequest) {
  try {
    const owned = await requireOwnedItem(request, {
      rateLimitKey: (userId) => `reconnect:${userId}`,
    });
    if (!owned.ok) return owned.response;
    const { user, item } = owned;

    // Confirm the re-link actually succeeded before trusting the item again:
    // a stale/forged item_id must not be able to flip an item back to active.
    // /item/get succeeds for any live item (update mode repairs the token in
    // place, it doesn't mint a new one), so a failure here means the item is
    // gone at Plaid or the token is unusable.
    try {
      await getPlaidClient().itemGet({ access_token: decryptItemToken(item) });
    } catch (error) {
      logError("plaid.reconnect.itemGet", error);
      return NextResponse.json(
        { error: "Could not confirm the re-link. Try connecting again." },
        { status: 400 },
      );
    }

    await setItemStatus(item.user_id, item.id, "active", null);

    if (item.institution_id) {
      const branding = await fetchInstitutionBranding(getPlaidClient(), {
        institutionId: item.institution_id,
        countryCodes: serverEnv.plaidCountryCodes as unknown as CountryCode[],
      });
      if (branding) {
        try {
          await updateItemBranding(user.id, item.id, {
            name: branding.name,
            logo: branding.logo,
            brandColor: branding.brandColor,
          });
        } catch (error) {
          logError("plaid.reconnect.branding", error);
        }
      }
    }

    // Catch up right away; if Plaid still needs a moment, the daily cron
    // (or the webhook) finishes the job.
    try {
      await syncItemTransactions({ ...item, status: "active" });
    } catch (error) {
      logError("plaid.reconnect.sync", error);
    }

    await writeAudit({
      userId: user.id,
      action: "plaid_reconnect",
      metadata: { institution_name: item.institution_name },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("plaid.reconnect", error);
  }
}
