import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { createServiceClient } from "@/lib/supabase/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isFeatureEnabled("statementVault")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await context.params;
    const { data: statement, error: loadError } = await auth.supabase
      .from("account_statements")
      .select("id,storage_path")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!statement) return NextResponse.json({ error: "Statement not found" }, { status: 404 });

    const service = createServiceClient();
    const { error: storageError } = await service.storage
      .from("statements")
      .remove([statement.storage_path as string]);
    if (storageError) throw storageError;
    const { error: deleteError } = await service
      .from("account_statements")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.user.id);
    if (deleteError) throw deleteError;
    await writeAudit({
      userId: auth.user.id,
      action: "statement_deleted",
      metadata: { statement_id: id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("statements.delete", error);
  }
}
