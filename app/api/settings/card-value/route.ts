import { NextResponse, type NextRequest } from "next/server";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { validateCardValueTerms } from "@/lib/card-value";

export async function PATCH(request: NextRequest) {
  if (!isFeatureEnabled("membershipTermsEntry")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json().catch(() => null)) as { terms?: unknown } | null;
    const validated = validateCardValueTerms(body?.terms);
    if (!validated.ok) return badRequest(validated.error);
    const { error } = await auth.supabase.from("profiles").update({ card_value_terms: validated.value }).eq("id", auth.user.id);
    if (error) throw error;
    await writeAudit({ userId: auth.user.id, action: "card_value_terms_updated", metadata: { count: validated.value.length }, ip: getClientIp(request) });
    return NextResponse.json({ ok: true, terms: validated.value });
  } catch (error) {
    return errorResponse("settings.card-value.patch", error);
  }
}
