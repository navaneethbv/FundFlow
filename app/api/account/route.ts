import { NextResponse, type NextRequest } from "next/server";
import { getPlaidClient } from "@/lib/plaid";
import { requireUser, errorResponse } from "@/lib/http";
import { listActiveItems, decryptItemToken } from "@/lib/plaid-service";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * User-controlled account deletion. Removes all Plaid items at Plaid, then
 * deletes the auth user, which cascades to profiles and every user-owned table.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    // Remove each bank connection at Plaid first (best effort).
    const items = await listActiveItems(user.id);
    const plaid = getPlaidClient();
    for (const item of items) {
      try {
        await plaid.itemRemove({ access_token: decryptItemToken(item) });
      } catch (error) {
        logError("account.delete.itemRemove", error);
      }
    }

    // Audit before deletion (audit_logs.user_id is ON DELETE SET NULL, so the
    // record survives the cascade).
    await writeAudit({
      userId: user.id,
      action: "account_delete",
      metadata: { items_removed: items.length },
      ip: getClientIp(request),
    });

    // Deleting the auth user cascades to all user-owned rows.
    const service = createServiceClient();
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("account.delete", error);
  }
}
