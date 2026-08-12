import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeManualHolding } from "@/lib/investments";
import { getClientIp, writeAudit } from "@/lib/audit";

/**
 * Manual holdings exist for users whose provider does not expose Investments
 * (or for cash/private assets Plaid never sees). They never claim market
 * freshness: the security row they create is user-owned, not the shared
 * Plaid-sourced kind, and the value stored is exactly quantity * price as of
 * the date the user typed in.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const result = normalizeManualHolding(body, today);
    if (!result.ok) return badRequest(result.error);
    const input = result.value;

    // Confirm the chosen account belongs to the caller before attaching a
    // holding to it — the RLS-bound client already scopes this select.
    const table = input.accountSource === "plaid" ? "accounts" : "manual_accounts";
    const { data: account, error: accountError } = await supabase
      .from(table)
      .select("id")
      .eq("id", input.accountId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const service = createServiceClient();
    const { data: security, error: securityError } = await service
      .from("securities")
      .insert({
        user_id: user.id,
        name: input.securityName,
        ticker: input.ticker,
        security_type: input.securityType,
        iso_currency_code: input.currency,
      })
      .select("id")
      .single();
    if (securityError) throw securityError;

    const value = Math.round(input.quantity * input.price * 100) / 100;
    const { data: holding, error: holdingError } = await service
      .from("holdings")
      .insert({
        user_id: user.id,
        account_id: input.accountSource === "plaid" ? input.accountId : null,
        manual_account_id: input.accountSource === "manual" ? input.accountId : null,
        security_id: security.id,
        quantity: input.quantity,
        institution_price: input.price,
        institution_value: value,
        as_of: input.asOf,
        source: "manual",
        is_active: true,
      })
      .select("id")
      .single();
    if (holdingError) throw holdingError;

    await service.from("holding_snapshots").insert({
      user_id: user.id,
      holding_id: holding.id,
      snapshot_date: input.asOf,
      quantity: input.quantity,
      price: input.price,
      value,
    });

    await writeAudit({
      userId: user.id,
      action: "manual_holding_created",
      metadata: { holding_id: holding.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ id: holding.id }, { status: 201 });
  } catch (error) {
    return errorResponse("investments.manual.create", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || !body.id) return badRequest("id is required");

    // Only a manual holding may be deleted here — Plaid-synced holdings are
    // owned by sync, not the user, and are deactivated by mark-and-sweep
    // instead of ever being deleted client-side.
    const { data: holding, error: findError } = await supabase
      .from("holdings")
      .select("id, source")
      .eq("id", body.id)
      .maybeSingle();
    if (findError) throw findError;
    if (holding?.source !== "manual") {
      return NextResponse.json({ error: "Manual holding not found" }, { status: 404 });
    }

    const service = createServiceClient();
    const { error } = await service
      .from("holdings")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id)
      .eq("source", "manual");
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "manual_holding_deleted",
      metadata: { holding_id: body.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("investments.manual.delete", error);
  }
}
