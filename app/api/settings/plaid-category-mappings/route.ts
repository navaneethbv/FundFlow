import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { normalizeDisplayCategory, normalizePlaidCode } from "@/lib/plaid-category-mapping";

type MappingInput = { pfc_detailed?: unknown; display_category?: unknown };

function parseMappings(value: unknown): Array<{ user_id: string; pfc_detailed: string; display_category: string }> | { error: string } {
  if (!Array.isArray(value) || value.length > 200) return { error: "mappings must be an array of at most 200 entries" };
  const seen = new Set<string>();
  const rows: Array<{ user_id: string; pfc_detailed: string; display_category: string }> = [];
  for (const item of value as MappingInput[]) {
    if (typeof item?.pfc_detailed !== "string" || typeof item.display_category !== "string") return { error: "each mapping needs a detailed code and category" };
    const pfcDetailed = normalizePlaidCode(item.pfc_detailed);
    const displayCategory = normalizeDisplayCategory(item.display_category);
    if (!pfcDetailed || !displayCategory) return { error: "detailed codes and categories cannot be empty" };
    if (seen.has(pfcDetailed)) return { error: "detailed codes must be unique" };
    seen.add(pfcDetailed);
    rows.push({ user_id: "", pfc_detailed: pfcDetailed, display_category: displayCategory });
  }
  return rows;
}

export async function GET() {
  if (!isFeatureEnabled("plaidCategoryMappings")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const { data, error } = await auth.supabase
      .from("plaid_category_mappings")
      .select("id,pfc_detailed,display_category,created_at,updated_at")
      .eq("user_id", auth.user.id)
      .order("pfc_detailed");
    if (error) throw error;
    return NextResponse.json({ mappings: data ?? [] });
  } catch (error) {
    return errorResponse("settings.plaid-category-mappings.list", error);
  }
}

export async function PUT(request: NextRequest) {
  if (!isFeatureEnabled("plaidCategoryMappings")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json().catch(() => null)) as { mappings?: unknown } | null;
    const parsed = parseMappings(body?.mappings);
    if ("error" in parsed) return badRequest(parsed.error);
    const rows = parsed.map((row) => ({ ...row, user_id: auth.user.id }));
    const { error } = await auth.supabase.rpc("replace_plaid_category_mappings", {
      p_user_id: auth.user.id,
      p_mappings: rows.map(({ pfc_detailed, display_category }) => ({ pfc_detailed, display_category })),
    });
    if (error) throw error;
    await writeAudit({ userId: auth.user.id, action: "plaid_category_mappings_updated", metadata: { count: rows.length }, ip: getClientIp(request) });
    return NextResponse.json({ mappings: rows.map((row) => ({ pfc_detailed: row.pfc_detailed, display_category: row.display_category })) });
  } catch (error) {
    return errorResponse("settings.plaid-category-mappings.update", error);
  }
}
