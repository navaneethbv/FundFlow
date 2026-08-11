import { NextResponse } from "next/server";
import { buildDataTakeout } from "@/lib/security-account";
import { collectUserData } from "@/lib/user-data";
import { errorResponse, requireUser } from "@/lib/http";

/**
 * Full data takeout. Reads run on the cookie-bound client, but RLS alone is no
 * longer a sufficient scope: `accounts`, `transactions`, and
 * `account_balance_snapshots` are additionally readable for a household
 * member's opted-in Plaid connections. Takeout means "the caller's own data",
 * so every query in lib/user-data.ts filters `user_id` explicitly — except the
 * two household-owned tables (`shared_expenses`, `households`), which are
 * scoped by the caller's involvement/ownership instead. Do not drop those
 * filters back to bare RLS.
 *
 * The table list lives in one place (lib/user-data.ts) and is shared with
 * `app/api/cron/backup/route.ts`, so takeout and backup cannot drift apart and
 * silently drop a user's own splits, refund links, receipts, tags, or goals
 * work.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const sections = await collectUserData(supabase, user.id);
    return NextResponse.json(buildDataTakeout(sections));
  } catch (error) {
    return errorResponse("export.takeout", error);
  }
}
