import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("importUndo") || !isFeatureEnabled("importHistory")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;
  if (!(await checkRateLimit(`import-undo:${user.id}`, 10, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many undo attempts. Please wait a while." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as { batch_id?: unknown } | null;
  if (!isUuid(body?.batch_id)) return badRequest("batch_id is required");

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("undo_import_batch", {
      p_user_id: user.id,
      p_batch_id: body.batch_id,
    });
    if (error) {
      if (error.code === "P0002") return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
      throw error;
    }
    const result = (data ?? {}) as { status?: string; reason?: string; deleted?: number };
    if (result.status === "refused") {
      return NextResponse.json({ error: result.reason ?? "This import cannot be undone safely." }, { status: 409 });
    }
    await writeAudit({
      userId: user.id,
      action: "import_undone",
      metadata: { batch_id: body.batch_id, deleted: result.deleted ?? 0, status: result.status ?? "unknown" },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse("import.undo", error);
  }
}
