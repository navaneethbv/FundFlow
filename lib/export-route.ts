import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { verifyApiToken } from "@/lib/api-tokens";
import { errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

export interface ExportContext {
  userId: string;
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
}

export async function resolveExportContext(
  request: NextRequest,
): Promise<ExportContext | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    const userId = await verifyApiToken(request.headers.get("authorization"));
    if (!userId) return auth;
    return { userId, supabase: createServiceClient() };
  }
  return { userId: auth.user.id, supabase: auth.supabase };
}

export async function recordExport(input: {
  request: NextRequest;
  userId: string;
  format: "json" | "csv" | "qif" | "pdf";
  rowCount: number;
}): Promise<void> {
  const { request, userId, format, rowCount } = input;
  const service = createServiceClient();
  await service.from("data_exports").insert({
    user_id: userId,
    format,
    row_count: rowCount,
  });
  await writeAudit({
    userId,
    action: "data_export",
    metadata: { format, row_count: rowCount },
    ip: getClientIp(request),
  });
}

export function exportError(context: string, error: unknown): NextResponse {
  return errorResponse(context, error);
}
