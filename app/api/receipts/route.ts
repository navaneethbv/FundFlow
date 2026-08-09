import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { normalizeReceiptImage } from "@/lib/receipt-image";
import {
  findReceiptCandidates,
  type ReceiptCandidate,
} from "@/lib/receipts";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const RECEIPT_SELECT =
  "id,user_id,transaction_id,storage_path,merchant,purchase_date,total,status,created_at";

interface ReceiptRow {
  id: string;
  user_id: string;
  transaction_id: string | null;
  storage_path: string;
  merchant: string | null;
  purchase_date: string | null;
  total: number | string | null;
  status: "unmatched" | "matched" | "ignored";
  created_at: string;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

async function loadCandidates(
  supabase: SupabaseClient,
  userId: string,
  receipt: ReceiptRow,
): Promise<ReceiptCandidate[]> {
  const total = Number(receipt.total);
  if (!receipt.merchant || !receipt.purchase_date || !Number.isFinite(total) || total <= 0) {
    return [];
  }
  const from = new Date(`${receipt.purchase_date}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 3);
  const to = new Date(`${receipt.purchase_date}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 3);
  const { data, error } = await supabase
    .from("transactions")
    .select("id,date,amount,merchant_name,name")
    .eq("user_id", userId)
    .gte("date", from.toISOString().slice(0, 10))
    .lte("date", to.toISOString().slice(0, 10))
    .limit(100);
  if (error) throw error;
  return findReceiptCandidates(
    {
      merchant: receipt.merchant,
      total,
      purchaseDate: receipt.purchase_date,
    },
    ((data ?? []) as Array<{
      id: string;
      date: string;
      amount: number | string;
      merchant_name: string | null;
      name: string | null;
    }>).map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      amount: Number(transaction.amount),
      merchantName: transaction.merchant_name,
      name: transaction.name,
    })),
  );
}

function publicReceipt(
  receipt: ReceiptRow,
  imageUrl: string,
  candidates: ReceiptCandidate[],
) {
  const { storage_path: _storagePath, user_id: _userId, ...safe } = receipt;
  return { ...safe, total: receipt.total === null ? null : Number(receipt.total), imageUrl, candidates };
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
    const file = form?.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    const merchantValue = form?.get("merchant");
    const merchant = typeof merchantValue === "string" && merchantValue.trim()
      ? merchantValue.trim()
      : null;
    if (merchant && merchant.length > 160) return badRequest("merchant is too long");
    const purchaseDateValue = form?.get("purchaseDate");
    const purchaseDate = typeof purchaseDateValue === "string" && purchaseDateValue
      ? purchaseDateValue
      : null;
    if (purchaseDate && !isIsoDate(purchaseDate)) return badRequest("purchaseDate is invalid");
    const totalValue = form?.get("total");
    const total = typeof totalValue === "string" && totalValue
      ? Number(totalValue)
      : null;
    if (total !== null && (!Number.isFinite(total) || total <= 0)) {
      return badRequest("total must be positive");
    }

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

    const candidates = await loadCandidates(
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
    const { data, error } = await auth.supabase
      .from("receipts")
      .select(RECEIPT_SELECT)
      .eq("user_id", auth.user.id)
      .order("status")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as ReceiptRow[];
    const service = createServiceClient();
    const bucket = service.storage.from("receipts");
    const receipts = await Promise.all(rows.map(async (receipt) => {
      const [{ data: signed, error: signedError }, candidates] = await Promise.all([
        bucket.createSignedUrl(receipt.storage_path, 3600),
        receipt.status === "unmatched"
          ? loadCandidates(auth.supabase, auth.user.id, receipt)
          : Promise.resolve([]),
      ]);
      if (signedError) throw signedError;
      return publicReceipt(receipt, signed.signedUrl, candidates);
    }));
    return NextResponse.json({ receipts });
  } catch (error) {
    return errorResponse("receipts.list", error);
  }
}
