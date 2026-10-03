import { NextResponse } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { parsePortfolioLookthroughInput } from "@/lib/portfolio-lookthrough-input";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!isFeatureEnabled("portfolioLookthrough")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = await readJsonBody(request, 24_000);
    if (body instanceof NextResponse) return body;
    const input = parsePortfolioLookthroughInput(body);
    if (typeof input === "string") return badRequest(input);
    if (!await checkRateLimit(`portfolio_lookthrough:${auth.user.id}`, 60, 3600, { failClosed: true })) {
      return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
    }
    const { data, error } = await createServiceClient().rpc("save_holding_constituent_weights", {
      p_user_id: auth.user.id,
      p_holding_id: input.holdingId,
      p_version: input.version,
      p_data: input.data,
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "Owned holding not found" }, { status: 404 });
    if (error?.code === "40001") return NextResponse.json({ error: "Holding changed. Reload before saving." }, { status: 409 });
    if (error?.code === "22023") return badRequest("Enter conserving constituent weights and a valid as-of date.");
    if (error) throw error;
    if (!Number.isInteger(data)) throw new Error("Look-through save returned no version");
    await writeAudit({ userId: auth.user.id, action: "portfolio_lookthrough_saved", metadata: { holding_id: input.holdingId, reset: input.data === null }, ip: getClientIp(request) });
    return NextResponse.json({ version: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse("portfolio-lookthrough.save", error);
  }
}
