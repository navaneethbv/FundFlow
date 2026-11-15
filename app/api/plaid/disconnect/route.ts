import { NextResponse, type NextRequest } from "next/server";
import { removeItemAtPlaid } from "@/lib/plaid-item-removal";
import { errorResponse } from "@/lib/http";
import { requireOwnedItem } from "@/lib/plaid-item-route";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * Disconnect a bank: remove the item at Plaid, then delete the local item and
 * all data derived from it (accounts, transactions, recurring cascade via FK).
 */
export async function POST(request: NextRequest) {
  try {
    const owned = await requireOwnedItem(request, {
      rateLimitKey: (userId) => `disconnect:${userId}`,
    });
    if (!owned.ok) return owned.response;
    const { user, item } = owned;

    if (item.status !== "disconnected") {
      try {
        await removeItemAtPlaid(item);
      } catch (error) {
        logError("plaid.disconnect.itemRemove", error);
        return NextResponse.json({ error: "The bank connection could not be removed. Try again." }, { status: 503 });
      }
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("plaid_items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "plaid_disconnect",
      metadata: { institution_name: item.institution_name },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("plaid.disconnect", error);
  }
}
