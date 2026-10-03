import { NextResponse } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { manualAssetsEnabled } from "@/lib/manual-asset-flags";
import { parseAssetInput } from "@/lib/manual-assets";
import { resolveViewerToday } from "@/lib/report-period";
import { createServiceClient } from "@/lib/supabase/service";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { getClientIp, writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  if (!manualAssetsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    if (!await checkRateLimit(`manual_assets:${auth.user.id}`, 60, 3600, { failClosed: true })) {
      return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
    }
    const body = await readJsonBody(request, 16384);
    if (body instanceof NextResponse) return body;
    const today = await resolveViewerToday(auth.supabase, auth.user.id);
    const input = parseAssetInput(body, today);
    if (typeof input === "string") return badRequest(input);
    const { data, error } = await createServiceClient().rpc("save_manual_asset", {
      p_user_id: auth.user.id, p_input: input, p_today: today,
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    if (error?.code === "40001") return NextResponse.json({ error: "Asset changed. Reload before saving." }, { status: 409 });
    if (error?.code === "22023") return badRequest("Check the valuation date and growth assumptions.");
    if (error) throw error;
    if (typeof data !== "string") throw new Error("Asset save returned no id");
    invalidateDashboardCache(auth.user.id);
    await writeAudit({ userId: auth.user.id, action: input.id ? "manual_account_updated" : "manual_account_created",
      metadata: { account_id: data, asset_kind: input.assetKind }, ip: getClientIp(request) });
    return NextResponse.json({ id: data }, { status: input.id ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse("manual-assets.save", error);
  }
}
