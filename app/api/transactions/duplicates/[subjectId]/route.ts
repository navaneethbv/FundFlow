import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

interface RouteContext {
  params: Promise<{ subjectId: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const subjectId = decodeURIComponent((await params).subjectId);
    if (!subjectId?.includes(":")) return badRequest("subjectId is invalid");
    const { data: link, error: linkError } = await auth.supabase
      .from("linked_duplicates")
      .select("subject_id")
      .eq("user_id", auth.user.id)
      .eq("subject_id", subjectId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) {
      return NextResponse.json({ error: "Duplicate link not found" }, { status: 404 });
    }
    const service = createServiceClient();
    const { error } = await service.rpc("undo_transaction_duplicate", {
      p_user_id: auth.user.id,
      p_subject_id: subjectId,
    });
    if (error) throw error;
    await writeAudit({
      userId: auth.user.id,
      action: "duplicate_undone",
      metadata: { subject_id: subjectId },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.duplicates.undo", error);
  }
}
