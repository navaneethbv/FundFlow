import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Sets the user-entered APR on one of the caller's accounts (1.10 debt
 * planner). Accounts have no RLS update policy for clients by design, so
 * this route validates ownership as the user, then writes the single
 * column with the service client scoped to (id, user_id).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      accountId?: string;
      apr?: number | null;
    } | null;
    if (!body?.accountId) return badRequest("accountId is required");
    const apr = body.apr;
    if (apr !== null && (typeof apr !== "number" || !Number.isFinite(apr) || apr < 0 || apr > 99.99)) {
      return badRequest("apr must be null or between 0 and 99.99");
    }

    // Ownership check runs as the user — RLS hides other users' accounts.
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", body.accountId)
      .maybeSingle();
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const service = createServiceClient();
    const { error } = await service
      .from("accounts")
      .update({ apr })
      .eq("id", body.accountId)
      .eq("user_id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "apr_updated",
      metadata: { account_id: body.accountId },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("accounts.apr", error);
  }
}
