import { NextResponse, type NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { readFormBody } from "@/lib/request-body";
import { getClientIp, writeAudit } from "@/lib/audit";
import { detectSourceFormat, getCsvColumns } from "@/lib/import";
import { prepareImportProfile } from "@/lib/import-profile-preview";
import { inspectImportCsv } from "@/lib/import-preflight";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    if (!isFeatureEnabled("importPreflight") || !isFeatureEnabled("importProfiles")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!await checkRateLimit(`import-preflight:${auth.user.id}`, 30, 3600, { failClosed: true })) return NextResponse.json({ error: "Too many file checks. Please try later." }, { status: 429 });
    const form = await readFormBody(request, 3 * 1024 * 1024);
    if (form instanceof NextResponse) return form;
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > 2 * 1024 * 1024) return badRequest("File must be 2 MB or smaller");
    const text = await file.text();
    const prepared = await prepareImportProfile(auth.supabase, auth.user.id, text, form);
    if (prepared.response) return prepared.response;
    const format = detectSourceFormat(prepared.text);
    const diagnostics = format === "csv" ? inspectImportCsv(text, {
      positiveIsIncome: form.get("positive_is_income") !== "false", layout: prepared.layout,
      columns: readColumnMap(form.get("column_map")), skipRows: Number(form.get("skip_rows") ?? 0),
    }) : null;
    await writeAudit({ userId: auth.user.id, action: "import_preflight", ip: getClientIp(request),
      metadata: { format, rows: diagnostics?.totalRows ?? 0, issues: diagnostics?.issueCount ?? 0 },
    });
    return NextResponse.json({ format, diagnostics, ...mappingPrompt(diagnostics, prepared.text) });
  } catch (error) {
    return errorResponse("import.preflight", error);
  }
}

function readColumnMap(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return undefined;
  return JSON.parse(value);
}

function mappingPrompt(diagnostics: ReturnType<typeof inspectImportCsv> | null, text: string) {
  if (!diagnostics?.issues.some(issue => issue.code === "mapping")) return {};
  const header = getCsvColumns(text);
  return { needs_mapping: true, headers: header?.headers ?? [], sample: header?.sample ?? [] };
}
