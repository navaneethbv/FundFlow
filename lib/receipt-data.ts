import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findReceiptCandidates,
  receiptAmountBandFilter,
  type ReceiptCandidate,
} from "@/lib/receipts";

export const RECEIPT_SELECT =
  "id,user_id,transaction_id,storage_path,merchant,purchase_date,total,status,created_at";

export interface ReceiptRow {
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

export interface ReceiptInboxRow {
  id: string;
  transaction_id: string | null;
  merchant: string | null;
  purchase_date: string | null;
  total: number | null;
  status: "unmatched" | "matched" | "ignored";
  created_at: string;
  imageUrl: string;
  candidates: ReceiptCandidate[];
}

export async function loadReceiptCandidates(
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
  // The amount predicate keeps the ±3-day window small enough that the cap is
  // a safety valve rather than a filter. Without it the true match can sit past
  // row 100 of an unordered page and simply never be considered — a silently
  // wrong "no candidates" rather than a visible failure.
  const { data, error } = await supabase
    .from("transactions")
    .select("id,date,amount,merchant_name,name")
    .eq("user_id", userId)
    .gte("date", from.toISOString().slice(0, 10))
    .lte("date", to.toISOString().slice(0, 10))
    .or(receiptAmountBandFilter(total))
    .order("date", { ascending: true })
    .limit(500);
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

export function publicReceipt(
  receipt: ReceiptRow,
  imageUrl: string,
  candidates: ReceiptCandidate[],
): ReceiptInboxRow {
  return {
    id: receipt.id,
    transaction_id: receipt.transaction_id,
    merchant: receipt.merchant,
    purchase_date: receipt.purchase_date,
    total: receipt.total === null ? null : Number(receipt.total),
    status: receipt.status,
    created_at: receipt.created_at,
    imageUrl,
    candidates,
  };
}

export async function loadReceiptInbox(
  supabase: SupabaseClient,
  service: SupabaseClient,
  userId: string,
): Promise<ReceiptInboxRow[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select(RECEIPT_SELECT)
    .eq("user_id", userId)
    .order("status")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const bucket = service.storage.from("receipts");
  return Promise.all(((data ?? []) as ReceiptRow[]).map(async (receipt) => {
    const [{ data: signed, error: signedError }, candidates] = await Promise.all([
      bucket.createSignedUrl(receipt.storage_path, 3600),
      receipt.status === "unmatched"
        ? loadReceiptCandidates(supabase, userId, receipt)
        : Promise.resolve([]),
    ]);
    if (signedError) throw signedError;
    return publicReceipt(receipt, signed.signedUrl, candidates);
  }));
}
