import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { detectColumns, detectSourceFormat, getCsvColumns, type DateOrder } from "@/lib/import";
import { createImportLayout, matchImportProfiles, normalizeImportLayout, stripImportPreamble, type ImportLayout, type ImportProfile } from "@/lib/import-profiles";

interface PreparedLayout {
  text: string;
  layout?: ImportLayout;
  profile?: { id: string; name: string };
  response?: NextResponse;
}

async function selectSavedProfile(supabase: SupabaseClient, userId: string, text: string, profileId: string | null): Promise<PreparedLayout> {
  const { data, error } = await supabase.from("import_profiles").select("id, name, layout").eq("user_id", userId).limit(100);
  if (error) throw error;
  const profiles: ImportProfile[] = (data ?? []).flatMap(row => {
    const layout = normalizeImportLayout(row.layout);
    return layout ? [{ id: row.id as string, name: row.name as string, layout }] : [];
  });
  const matches = matchImportProfiles(text, profiles);
  const selected = profileId ? matches.find(row => row.id === profileId) : matches.length === 1 ? matches[0] : undefined;
  if (profileId && !selected) return { text, response: badRequest("Saved layout does not match this file") };
  if (selected) return { text, layout: selected.layout, profile: { id: selected.id, name: selected.name } };
  if (matches.length > 1) return {
    text,
    response: NextResponse.json({ needs_profile_choice: true, profiles: matches.map(({ id, name }) => ({ id, name })) }),
  };
  return { text };
}

function prepareManualLayout(text: string, preparedText: string, form: FormData, skipRows: number): PreparedLayout {
  const header = getCsvColumns(preparedText);
  const dateOrderRaw = form.get("date_order");
  const dateOrder = ["mdy", "dmy", "ymd"].includes(String(dateOrderRaw)) ? dateOrderRaw as DateOrder : undefined;
  const mapping = form.get("column_map");
  let columns: unknown;
  try { columns = typeof mapping === "string" ? JSON.parse(mapping) : header && detectColumns(header.headers); }
  catch { return { text, response: badRequest("Invalid column mapping") }; }
  const layout = createImportLayout(text, { columns, dateOrder, positiveIsIncome: form.get("positive_is_income") !== "false", skipRows });
  return { text: preparedText, ...(layout ? { layout } : {}) };
}

export async function prepareImportProfile(supabase: SupabaseClient, userId: string, text: string, form: FormData): Promise<PreparedLayout> {
  if (!isFeatureEnabled("importProfiles")) {
    return form.has("profile_id") || form.has("skip_rows")
      ? { text, response: NextResponse.json({ error: "Not found" }, { status: 404 }) }
      : { text };
  }
  const skipRows = Number(form.get("skip_rows") ?? 0);
  if (!Number.isInteger(skipRows) || skipRows < 0 || skipRows > 20) return { text, response: badRequest("Leading row count must be between 0 and 20") };
  const profileId = form.get("profile_id");
  if (profileId !== null && typeof profileId !== "string") return { text, response: badRequest("Invalid saved layout") };
  const preparedText = stripImportPreamble(text, skipRows);
  // Dedicated app/OFX importers retain their account, notes, and sign semantics.
  if (detectSourceFormat(text) !== "csv" || detectSourceFormat(preparedText) !== "csv") return { text: preparedText };
  if (profileId !== "manual" && !form.has("column_map")) {
    const selected = await selectSavedProfile(supabase, userId, text, profileId);
    if (selected.layout || selected.response) return selected;
  }
  return prepareManualLayout(text, preparedText, form, skipRows);
}
