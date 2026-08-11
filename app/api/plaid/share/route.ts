import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Per-connection household sharing (4.2): the item's OWNER opts a bank
 * connection into (or out of) household visibility. Ownership and household
 * membership are both verified with the user-scoped client (RLS enforces
 * them); the service client only performs the single column write.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      itemId?: string;
      share?: boolean;
      householdId?: string;
    } | null;
    if (!body?.itemId || typeof body.share !== "boolean") {
      return badRequest("itemId and share are required");
    }
    if (body.share && typeof body.householdId !== "string") {
      return badRequest("householdId is required when sharing");
    }

    // Owner-only: plaid_items has no household select policy, so this
    // lookup only resolves for the item's owner.
    const { data: item } = await supabase
      .from("plaid_items")
      .select("id")
      .eq("id", body.itemId)
      .maybeSingle();
    if (!item) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }

    let householdId: string | null = null;
    if (body.share) {
      // Explicit target household, verified as a member by RLS: the
      // user-scoped client only resolves households the caller belongs to, so
      // this cannot pick an arbitrary one for a multi-household user.
      const { data: household } = await supabase
        .from("households")
        .select("id")
        .eq("id", body.householdId)
        .maybeSingle();
      if (!household) {
        return badRequest("You are not a member of that household");
      }
      householdId = household.id as string;
    }

    const service = createServiceClient();
    const { error } = await service
      .from("plaid_items")
      .update({ shared_household_id: householdId })
      .eq("id", body.itemId)
      .eq("user_id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "household_share_changed",
      metadata: { item_id: body.itemId, shared: body.share },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, householdId });
  } catch (error) {
    return errorResponse("plaid.share", error);
  }
}
