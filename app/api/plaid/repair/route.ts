import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getPlaidClient } from "@/lib/plaid";
import { decryptItemToken, setItemStatus, updateItemCursor } from "@/lib/plaid-service";
import { syncItemTransactions } from "@/lib/sync";
import { createServiceClient } from "@/lib/supabase/service";
import type { PlaidItemRow } from "@/lib/types";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const allowed = await checkRateLimit(`repair:${user.id}`, 3, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many repair attempts. Please wait a moment before trying again." },
      { status: 429 },
    );
  }

  let body: { itemId?: string; action?: "diagnose" | "resync" | "reset_cursor" } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itemId, action = "resync" } = body;
  if (!itemId) {
    return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: item, error: itemError } = await supabase
    .from("plaid_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (itemError || !item) {
    return NextResponse.json({ error: "Institution connection not found." }, { status: 404 });
  }

  const typedItem = item as PlaidItemRow;

  try {
    const plaid = getPlaidClient();
    const token = decryptItemToken(typedItem);

    // 1. Diagnose connection status with Plaid /item/get
    let itemDetails;
    try {
      const resp = await plaid.itemGet({ access_token: token });
      itemDetails = resp.data.item;
    } catch (err: unknown) {
      logError("plaid.repair.itemGet", err);
      const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code ?? "ITEM_LOGIN_REQUIRED";
      await setItemStatus(typedItem.id, "error", code);
      return NextResponse.json({
        ok: false,
        status: "repair_required",
        errorCode: code,
        message: "Institution login or re-authentication required.",
      });
    }

    if (action === "diagnose") {
      return NextResponse.json({
        ok: true,
        status: typedItem.status,
        availableProducts: itemDetails.available_products,
        billedProducts: itemDetails.billed_products,
        consentExpirationTime: itemDetails.consent_expiration_time,
      });
    }

    // 2. If reset_cursor is requested (e.g. to perform a full historical backfill safely)
    if (action === "reset_cursor") {
      await updateItemCursor(typedItem.id, null);
      typedItem.sync_cursor = null;
    }

    // 3. Trigger safe sync
    const syncResult = await syncItemTransactions({
      ...typedItem,
      status: "active",
    });

    await writeAudit({
      userId: user.id,
      action: "plaid_repair",
      metadata: {
        itemId: typedItem.id,
        action,
        syncResult,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      ok: true,
      status: "healthy",
      syncResult,
    });
  } catch (error) {
    return errorResponse("plaid.repair", error);
  }
}
