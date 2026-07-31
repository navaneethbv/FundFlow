import { NextResponse, type NextRequest } from "next/server";
import { validateDisplayPrefsPatch, parseDisplayPrefs } from "@/components/settings/settings-nav";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { validateProfilePatch } from "@/lib/profile";

/** Gated the same as the Settings UI: these columns don't exist until
 *  20260730250000_profile_and_tags.sql is applied. */
function notFoundIfSettingsIaOff(): NextResponse | null {
  if (isFeatureEnabled("settingsIa")) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Two write shapes behind one PATCH: `{kind:"profile", ...}` for name/
 * birthday, `{kind:"display", ...}` for display_prefs. Both are a
 * read-merge-write against the same `profiles` row — dashboard_prefs and
 * advice_priorities live there too, so overwriting the column instead of
 * merging would silently clobber a sibling feature's saved state.
 */
export async function PATCH(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;

    if (body?.kind === "profile") {
      const today = new Date().toISOString().slice(0, 10);
      const result = validateProfilePatch(body, today);
      if (!result.ok) return badRequest(result.error);

      const update: Record<string, string | null> = {};
      if (result.value.fullName !== undefined) update.full_name = result.value.fullName;
      if (result.value.displayName !== undefined) update.display_name = result.value.displayName;
      if (result.value.birthday !== undefined) update.birthday = result.value.birthday;

      const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "profile_updated",
        metadata: { fields: Object.keys(update) },
        ip: getClientIp(request),
      });
      return NextResponse.json({ ok: true });
    }

    if (body?.kind === "display") {
      const result = validateDisplayPrefsPatch((body as { prefs?: unknown }).prefs);
      if (!result.ok) return badRequest(result.error);

      const { data: existing, error: readError } = await supabase
        .from("profiles")
        .select("display_prefs")
        .eq("id", user.id)
        .maybeSingle();
      if (readError) throw readError;

      const merged = { ...parseDisplayPrefs(existing?.display_prefs), ...result.value };
      const { error } = await supabase
        .from("profiles")
        .update({ display_prefs: merged })
        .eq("id", user.id);
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "display_prefs_updated",
        metadata: { fields: Object.keys(result.value) },
        ip: getClientIp(request),
      });
      return NextResponse.json({ ok: true, prefs: merged });
    }

    return badRequest("kind must be 'profile' or 'display'");
  } catch (error) {
    return errorResponse("settings.profile.patch", error);
  }
}

/** Avatar upload. Original bytes are stripped of nothing beyond what the browser already discards on re-encode — kept simple since these are user-facing profile photos, not sensitive documents. */
export async function POST(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > MAX_AVATAR_BYTES) return badRequest("Image too large (3 MB max)");
    const extension = AVATAR_TYPES[file.type];
    if (!extension) return badRequest("Unsupported image type");

    const path = `${user.id}/avatar.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", user.id);
    if (updateError) throw updateError;

    await writeAudit({
      userId: user.id,
      action: "avatar_updated",
      metadata: {},
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    return errorResponse("settings.profile.avatar.upload", error);
  }
}

export async function DELETE(request: NextRequest) {
  const gated = notFoundIfSettingsIaOff();
  if (gated) return gated;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("avatar_path")
      .eq("id", user.id)
      .maybeSingle();
    if (readError) throw readError;

    if (profile?.avatar_path) {
      await supabase.storage.from("avatars").remove([profile.avatar_path]);
    }

    const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "avatar_updated",
      metadata: { removed: true },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("settings.profile.avatar.delete", error);
  }
}
