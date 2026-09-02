import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { parseTemplateItems } from "@/lib/budget-template";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS = "id, name, items, created_at";

function serializeRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    items: row.items,
    createdAt: row.created_at,
  };
}

/**
 * Owner-scoped CRUD for saved budget templates. An apply (with its
 * overwrite/merge confirmation) lives in /api/budget/templates/apply.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const { data, error } = await supabase
      .from("budget_templates")
      .select(SELECT_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at");
    if (error) throw error;
    return NextResponse.json({ templates: (data ?? []).map(serializeRow) });
  } catch (error) {
    return errorResponse("budget.templates.list", error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return badRequest("Invalid template name");
    const items = parseTemplateItems(body?.items);
    if (!items.ok) return badRequest(items.message);

    const { data, error } = await supabase
      .from("budget_templates")
      .insert({ user_id: user.id, name, items: items.value })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    await writeAudit({
      userId: user.id,
      action: "budget_template_created",
      metadata: { template_id: data.id, item_count: items.value.length },
      ip: getClientIp(request),
    });
    return NextResponse.json({ template: serializeRow(data) }, { status: 201 });
  } catch (error) {
    return errorResponse("budget.templates.create", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || !UUID_REGEX.test(id)) return badRequest("Invalid template id");
    const { data, error } = await supabase
      .from("budget_templates")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest("Template not found");
    await writeAudit({
      userId: user.id,
      action: "budget_template_deleted",
      metadata: { template_id: id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("budget.templates.delete", error);
  }
}
