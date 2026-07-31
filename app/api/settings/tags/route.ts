import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { planTagRename, validateTagName } from "@/lib/tags";

/** Gated the same as the Settings UI: user_tags doesn't exist until
 *  20260730250000_profile_and_tags.sql is applied. */
function notFoundIfSettingsIaOff(): NextResponse | null {
  if (isFeatureEnabled("settingsIa")) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const result = validateTagName((body as { name?: unknown } | null)?.name);
    if (!result.ok) return badRequest(result.error);

    const { data: tag, error } = await supabase
      .from("user_tags")
      .insert({ user_id: user.id, name: result.value })
      .select("id, name, color_slot")
      .single();
    if (error) {
      if (error.code === "23505") return badRequest("That tag already exists.");
      throw error;
    }

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    return errorResponse("settings.tags.create", error);
  }
}

export async function PATCH(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as
      | { oldName?: unknown; newName?: unknown }
      | null;

    const { data: existing, error: listError } = await supabase
      .from("user_tags")
      .select("name")
      .eq("user_id", user.id);
    if (listError) throw listError;

    const plan = planTagRename(body?.oldName, body?.newName, (existing ?? []).map((t) => t.name as string));
    if (!plan.ok) return badRequest(plan.error);

    const { error } = await supabase.rpc("rename_user_tag", {
      p_old_name: plan.value.oldName,
      p_new_name: plan.value.newName,
    });
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: plan.value.isMerge ? "tag_merged" : "tag_renamed",
      metadata: { old_name: plan.value.oldName, new_name: plan.value.newName },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, merged: plan.value.isMerge });
  } catch (error) {
    return errorResponse("settings.tags.rename", error);
  }
}

export async function DELETE(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const result = validateTagName(body?.name);
    if (!result.ok) return badRequest(result.error);

    const { error } = await supabase
      .from("user_tags")
      .delete()
      .eq("user_id", user.id)
      .eq("name", result.value);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "tag_deleted",
      metadata: { name: result.value },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("settings.tags.delete", error);
  }
}
