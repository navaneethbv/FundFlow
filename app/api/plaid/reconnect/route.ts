import { NextResponse, type NextRequest } from "next/server";
import { CountryCode } from "plaid";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { getItem, setItemStatus, updateItemBranding } from "@/lib/plaid-service";
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
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const itemId = (body as { item_id?: unknown }).item_id;
  if (typeof itemId !== "string" || itemId.length === 0) {
    return badRequest("item_id is required");
  }

  try {
    const item = await getItem(user.id, itemId);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    await setItemStatus(item.id, "active", null);

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
