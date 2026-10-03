import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import {
  isStatementMonth,
  MAX_STATEMENT_BYTES,
  parseStatementAccountRef,
  sanitizeStatementFilename,
  type StatementAccountRef,
} from "@/lib/statement-vault";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readFormBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const STATEMENT_SELECT = "id,account_id,manual_account_id,statement_month,original_filename,content_type,size_bytes,created_at";

interface StatementRow {
  id: string;
  account_id: string | null;
  manual_account_id: string | null;
  statement_month: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

function publicStatement(row: StatementRow) {
  const account = row.account_id
    ? `account:${row.account_id}`
    : `manual:${row.manual_account_id}`;
  return {
    id: row.id,
    account,
    month: row.statement_month,
    filename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

async function accountIsOwned(
  supabase: SupabaseClient,
  userId: string,
  account: StatementAccountRef,
): Promise<boolean> {
  const table = account.source === "account" ? "accounts" : "manual_accounts";
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", account.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function validPdf(file: File): boolean {
  return (
    file.size > 0 &&
    file.size <= MAX_STATEMENT_BYTES &&
    file.name.toLowerCase().endsWith(".pdf")
  );
}

async function hasPdfMagic(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return new TextDecoder().decode(bytes) === "%PDF-";
}

interface PreparedStatementUpload {
  file: File;
  account: StatementAccountRef;
  month: string;
}

async function prepareStatementUpload(
  request: NextRequest,
): Promise<PreparedStatementUpload | NextResponse> {
  const form = await readFormBody(request, MAX_STATEMENT_BYTES + 1024 * 1024);
  if (form instanceof NextResponse) return form;
  const file = form.get("file");
  const account = parseStatementAccountRef(form.get("account"));
  const month = form.get("month");
  if (!(file instanceof File)) return badRequest("file is required");
  if (!account) return badRequest("account must be account:id or manual:id");
  if (!isStatementMonth(month)) return badRequest("month must be the first day of a month");
  if (!validPdf(file) || (file.type && file.type !== "application/pdf")) {
    return badRequest("Only PDF statements up to 15 MiB are accepted");
  }
  if (!(await hasPdfMagic(file))) return badRequest("The uploaded file is not a PDF");
  return { file, account, month };
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("statementVault")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const allowed = await checkRateLimit(`statement-upload:${auth.user.id}`, 20, 3600, { failClosed: true });
    if (!allowed) return NextResponse.json({ error: "Statement upload limit reached." }, { status: 429 });

    const prepared = await prepareStatementUpload(request);
    if (prepared instanceof NextResponse) return prepared;
    const { file, account, month } = prepared;
    if (!(await accountIsOwned(auth.supabase, auth.user.id, account))) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const id = randomUUID();
    const storagePath = `${auth.user.id}/${account.source}/${account.id}/${month}/${id}.pdf`;
    const service = createServiceClient();
    const bucket = service.storage.from("statements");
    const { error: uploadError } = await bucket.upload(
      storagePath,
      new Uint8Array(await file.arrayBuffer()),
      { contentType: "application/pdf", upsert: false },
    );
    if (uploadError) throw uploadError;

    const row = {
      id,
      user_id: auth.user.id,
      account_id: account.source === "account" ? account.id : null,
      manual_account_id: account.source === "manual" ? account.id : null,
      statement_month: month,
      storage_path: storagePath,
      original_filename: sanitizeStatementFilename(file.name),
      content_type: "application/pdf",
      size_bytes: file.size,
    };
    const { data, error: insertError } = await service
      .from("account_statements")
      .insert(row)
      .select(STATEMENT_SELECT)
      .single();
    if (insertError || !data) {
      await bucket.remove([storagePath]);
      if (insertError) throw insertError;
      throw new Error("Statement create returned no row");
    }

    await writeAudit({
      userId: auth.user.id,
      action: "statement_uploaded",
      metadata: { statement_id: id, account, month, size_bytes: file.size },
      ip: getClientIp(request),
    });
    return NextResponse.json({ statement: publicStatement(data as StatementRow) }, { status: 201 });
  } catch (error) {
    return errorResponse("statements.create", error);
  }
}

export async function GET(request: NextRequest) {
  if (!isFeatureEnabled("statementVault")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    let query = auth.supabase
      .from("account_statements")
      .select(STATEMENT_SELECT)
      .order("statement_month", { ascending: false })
      .order("created_at", { ascending: false });
    const accountParam = request.nextUrl.searchParams.get("account");
    const monthParam = request.nextUrl.searchParams.get("month");
    const account = accountParam ? parseStatementAccountRef(accountParam) : null;
    if (accountParam && !account) return badRequest("account must be account:id or manual:id");
    if (monthParam && !isStatementMonth(monthParam)) return badRequest("month must be the first day of a month");
    if (account?.source === "account") query = query.eq("account_id", account.id);
    if (account?.source === "manual") query = query.eq("manual_account_id", account.id);
    if (monthParam) query = query.eq("statement_month", monthParam);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ statements: ((data ?? []) as StatementRow[]).map(publicStatement) });
  } catch (error) {
    return errorResponse("statements.list", error);
  }
}
