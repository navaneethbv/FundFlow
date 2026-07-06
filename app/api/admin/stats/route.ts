import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

/** Admin-only debug endpoint: aggregate counts. RBAC enforced by requireAdmin. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const service = createServiceClient();
    const [items, accounts, txns] = await Promise.all([
      service.from("plaid_items").select("id", { count: "exact", head: true }),
      service.from("accounts").select("id", { count: "exact", head: true }),
      service.from("transactions").select("id", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      plaid_items: items.count ?? 0,
      accounts: accounts.count ?? 0,
      transactions: txns.count ?? 0,
    });
  } catch (error) {
    return errorResponse("admin.stats", error);
  }
}
