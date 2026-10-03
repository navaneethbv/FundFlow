import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("merchantsPage")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json().catch(() => null)) as { source_merchant?: unknown; target_merchant?: unknown } | null;
    if (typeof body?.source_merchant !== "string" || typeof body.target_merchant !== "string") return badRequest("source_merchant and target_merchant are required");
    const source = body.source_merchant.trim().slice(0, 120);
    const target = body.target_merchant.trim().slice(0, 120);
    if (!source || !target || source.toLowerCase() === target.toLowerCase()) return badRequest("Choose two different merchant names");
    const { error } = await createServiceClient().rpc("merge_merchants", { p_user_id: auth.user.id, p_source_merchant: source, p_target_merchant: target });
    if (error) throw error;
    await writeAudit({ userId: auth.user.id, action: "merchant_alias_saved", metadata: { source, target }, ip: getClientIp(request) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("merchants.merge", error);
  }
}
