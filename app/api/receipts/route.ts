import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import {
  loadReceiptCandidates,
  loadReceiptInbox,
  publicReceipt,
  RECEIPT_SELECT,
  type ReceiptRow,
} from "@/lib/receipt-data";
import { normalizeReceiptImage } from "@/lib/receipt-image";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

interface ParsedReceiptForm {
  file: File;
  merchant: string | null;
  purchaseDate: string | null;
  total: number | null;
  errorResponse?: NextResponse;
}

function parseReceiptUploadForm(form: FormData | null): ParsedReceiptForm {
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return { file: null as unknown as File, merchant: null, purchaseDate: null, total: null, errorResponse: badRequest("file is required") };
  }
  const merchantValue = form?.get("merchant");
  const merchant = typeof merchantValue === "string" && merchantValue.trim() ? merchantValue.trim() : null;
  if (merchant && merchant.length > 160) {
    return { file, merchant: null, purchaseDate: null, total: null, errorResponse: badRequest("merchant is too long") };
  }
  const purchaseDateValue = form?.get("purchaseDate");
  const purchaseDate = typeof purchaseDateValue === "string" && purchaseDateValue ? purchaseDateValue : null;
  if (purchaseDate && !isIsoDate(purchaseDate)) {
    return { file, merchant, purchaseDate: null, total: null, errorResponse: badRequest("purchaseDate is invalid") };
  }
  const totalValue = form?.get("total");
  const total = typeof totalValue === "string" && totalValue ? Number(totalValue) : null;
  if (total !== null && (!Number.isFinite(total) || total <= 0)) {
    return { file, merchant, purchaseDate, total: null, errorResponse: badRequest("total must be positive") };
  }
  return { file, merchant, purchaseDate, total };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const allowed = await checkRateLimit(`receipt-upload:${auth.user.id}`, 30, 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Receipt upload limit reached." }, { status: 429 });
    }

    const form = await request.formData().catch(() => null);
    const parsedForm = parseReceiptUploadForm(form);
    if (parsedForm.errorResponse) return parsedForm.errorResponse;
    const { file, merchant, purchaseDate, total } = parsedForm;

    let image;
    try {
      image = await normalizeReceiptImage(file);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "invalid_image");
    }

    const id = randomUUID();
    const storagePath = `${auth.user.id}/${id}.${image.extension}`;
    const service = createServiceClient();
    const bucket = service.storage.from("receipts");
    const { error: uploadError } = await bucket.upload(storagePath, image.buffer, {
      contentType: image.contentType,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: receipt, error: insertError } = await service
      .from("receipts")
      .insert({
        id,
        user_id: auth.user.id,
        storage_path: storagePath,
        merchant,
        purchase_date: purchaseDate,
        total,
        status: "unmatched",
      })
      .select(RECEIPT_SELECT)
      .single();
    if (insertError || !receipt) {
      await bucket.remove([storagePath]);
      if (insertError) throw insertError;
      throw new Error("Receipt create returned no row");
    }

    const candidates = await loadReceiptCandidates(
      auth.supabase,
      auth.user.id,
      receipt as ReceiptRow,
    );
    const { data: signed, error: signedError } = await bucket.createSignedUrl(storagePath, 3600);
    if (signedError) throw signedError;
    await writeAudit({
      userId: auth.user.id,
      action: "receipt_uploaded",
      metadata: { receipt_id: receipt.id },
      ip: getClientIp(request),
    });
    return NextResponse.json(
      { receipt: publicReceipt(receipt as ReceiptRow, signed.signedUrl, candidates) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse("receipts.create", error);
  }
}

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const service = createServiceClient();
    const receipts = await loadReceiptInbox(auth.supabase, service, auth.user.id);
    return NextResponse.json({ receipts });
  } catch (error) {
    return errorResponse("receipts.list", error);
  }
}
