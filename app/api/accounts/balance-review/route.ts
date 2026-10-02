import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readJsonBody } from "@/lib/request-body";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    if (!isFeatureEnabled("balanceQualityReview"))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`balance-review:${auth.user.id}`, 60, 3600, {
        failClosed: true,
      }))
    ) {
      return NextResponse.json(
        { error: "Too many decisions. Try again later." },
        { status: 429 },
      );
    }
    const body = await readJsonBody(request, 2048);
    if (body instanceof NextResponse) return body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return badRequest("Invalid decision");
    const { reviewId, version, decision } = body as Record<string, unknown>;
    if (
      typeof reviewId !== "string" ||
      !UUID.test(reviewId) ||
      typeof version !== "string" ||
      !UUID.test(version) ||
      (decision !== "accepted" && decision !== "carried")
    )
      return badRequest("Invalid decision");
    // Ownership, current observation, and decision version are checked atomically.
    const { error } = await createServiceClient().rpc(
      "resolve_balance_quality_review",
      {
        p_user_id: auth.user.id,
        p_review_id: reviewId,
        p_version: version,
        p_decision: decision,
      },
    );
    if (error?.code === "P0002")
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    if (error?.code === "40001")
      return NextResponse.json(
        { error: "This review changed. Reload before deciding." },
        { status: 409 },
      );
    if (error?.code === "22023")
      return badRequest("No reliable balance is available to carry forward");
    if (error) throw error;
    await writeAudit({
      userId: auth.user.id,
      action: "balance_quality_reviewed",
      metadata: { reviewId, decision },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("balance-review.resolve", error);
  }
}
