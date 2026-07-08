import { NextResponse, type NextRequest } from "next/server";
import { buildAuditLogPage } from "@/lib/security-account";
import { errorResponse, requireUser } from "@/lib/http";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20));
    const { data, error } = await supabase
      .from("audit_logs")
      .select("action, metadata, created_at, user_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (error) throw error;

    const page = buildAuditLogPage(
      (data ?? []).map((row) => ({
        userId: row.user_id as string | null,
        action: row.action as string,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      })),
      user.id,
      limit,
    );

    return NextResponse.json(page);
  } catch (error) {
    return errorResponse("settings.audit", error);
  }
}
