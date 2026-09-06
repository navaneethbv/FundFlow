import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { verifyApiToken } from "@/lib/api-tokens";
import { errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";

export interface ExportContext {
  userId: string;
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
}

export async function resolveExportContext(
  request: NextRequest,
): Promise<ExportContext | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return auth;
    const ip = getClientIp(request);
    const allowed = await checkRateLimit(`export-token-ip:${ip}`, 60, 60, { failClosed: true });
    if (!allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
    const userId = await verifyApiToken(authHeader);
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
  // Checked (A-13): a silently dropped export journal row would claim an
  // audit trail the database never recorded.
  const { error } = await service.from("data_exports").insert({
    user_id: userId,
    format,
    row_count: rowCount,
  });
  if (error) throw error;
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
