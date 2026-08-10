import { createClient } from "@supabase/supabase-js";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";
import { fetchInstitutionBranding } from "../lib/plaid-institution.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const plaidEnvironment = process.env.PLAID_ENV ?? "sandbox";
const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[plaidEnvironment] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": required("PLAID_CLIENT_ID"),
      "PLAID-SECRET": required("PLAID_SECRET"),
    },
  },
}));
const countryCodes = (process.env.PLAID_COUNTRY_CODES ?? "US")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean) as CountryCode[];

const { data, error } = await supabase
  .from("plaid_items")
  .select("id,user_id,institution_id")
  .not("institution_id", "is", null)
  .order("institution_id");
if (error) throw error;

const byInstitution = new Map<string, Array<{ id: string; user_id: string }>>();
for (const row of data ?? []) {
  if (!row.institution_id) continue;
  const rows = byInstitution.get(row.institution_id) ?? [];
  rows.push({ id: row.id, user_id: row.user_id });
  byInstitution.set(row.institution_id, rows);
}

let updated = 0;
let skipped = 0;
let failed = 0;
for (const [institutionId, rows] of byInstitution) {
  const branding = await fetchInstitutionBranding(plaid, {
    institutionId,
    countryCodes,
  });
  if (!branding) {
    failed += rows.length;
    continue;
  }
  for (const row of rows) {
    const { error: updateError } = await supabase
      .from("plaid_items")
      .update({
        institution_name: branding.name,
        institution_logo: branding.logo,
        institution_brand_color: branding.brandColor,
      })
      .eq("id", row.id)
      .eq("user_id", row.user_id);
    if (updateError) failed += 1;
    else if (branding.logo || branding.brandColor) updated += 1;
    else skipped += 1;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

console.log(JSON.stringify({
  institutions: byInstitution.size,
  items: data?.length ?? 0,
  updated,
  skipped,
  failed,
}));
if (failed > 0) process.exitCode = 1;
