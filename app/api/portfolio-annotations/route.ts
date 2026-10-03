import { NextResponse } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { manualAssetsEnabled } from "@/lib/manual-asset-flags";
import { parsePortfolioInput } from "@/lib/portfolio-input";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readJsonBody(request, 8192);
    if (body instanceof NextResponse) return body;
    const input = parsePortfolioInput(body);
    if (typeof input === "string") return badRequest(input);
    const enabled = { basis: isFeatureEnabled("investmentBasis"), tax: isFeatureEnabled("investmentTaxBuckets"), mortgage: isFeatureEnabled("mortgageEquity") && manualAssetsEnabled() && isFeatureEnabled("amortizationEngine") };
    if (!enabled[input.kind]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!await checkRateLimit(`portfolio_annotations:${auth.user.id}`, 60, 3600, { failClosed: true })) return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
    const { data, error } = await createServiceClient().rpc("save_portfolio_annotation", {
      p_user_id: auth.user.id, p_kind: input.kind, p_id: input.id, p_version: input.version, p_data: input.data,
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "Owned record not found" }, { status: 404 });
    if (error?.code === "40001") return NextResponse.json({ error: "Record changed. Reload before saving." }, { status: 409 });
    if (error?.code === "23505") return NextResponse.json({ error: "This liability is already linked to a property." }, { status: 409 });
    if (error) throw error;
    if (!Number.isInteger(data)) throw new Error("Annotation save returned no version");
    await writeAudit({ userId: auth.user.id, action: "portfolio_annotation_saved", metadata: { kind: input.kind, id: input.id, reset: input.data === null }, ip: getClientIp(request) });
    return NextResponse.json({ version: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse("portfolio-annotations.save", error); }
}
