import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { ADVICE_LIBRARY } from "@/lib/advice-content";

const VALID_IDS = new Set(ADVICE_LIBRARY.map((item) => item.id));

/**
 * Persist the user's advice topic order (pin/reorder). The educational content
 * contract is unchanged; only the display order is saved, scoped to the
 * authenticated owner and audited.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = await request.json().catch(() => null);
    const adviceIds = (body as { advice_ids?: unknown } | null)?.advice_ids;
    if (!Array.isArray(adviceIds)) return badRequest("advice_ids must be an array");
    if (adviceIds.length > 50) return badRequest("Too many advice ids");
    const ids: string[] = [];
    for (const raw of adviceIds) {
      if (typeof raw !== "string") return badRequest("advice_ids must contain strings");
      if (!VALID_IDS.has(raw)) return badRequest(`Unknown advice id: ${raw}`);
      if (!ids.includes(raw)) ids.push(raw);
    }
    const { error } = await supabase
      .from("profiles")
      .update({ advice_priorities: ids })
      .eq("id", user.id);
    if (error) throw error;
    await writeAudit({
      userId: user.id,
      action: "advice_priorities_updated",
      metadata: { advice_ids: ids },
    });
    return NextResponse.json({ ok: true, advice_ids: ids });
  } catch (error) {
    return errorResponse("advice.priorities", error);
  }
}
