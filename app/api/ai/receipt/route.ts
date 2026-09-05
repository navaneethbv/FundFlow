import { NextResponse, type NextRequest } from "next/server";
import {
  extractReceiptWithProvider,
  isAiProviderConfigured,
} from "@/lib/ai-provider";
import { resolveAiConsent } from "@/lib/ai-gate";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { findReceiptCandidates, receiptAmountBandFilter } from "@/lib/receipts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Receipt scanning (Bucket 2): a receipt photo goes to the vision model,
 * which extracts merchant/amount/date/line items; the route then looks for
 * a matching ledger transaction (amount ±1%, date ±3 days). The image
 * leaves the app — that's why this sits behind the same double consent as
 * AI insights, is rate-limited (10/day), and is never automatic. The image
 * is never stored; the extraction is returned to the client, which decides
 * whether to attach it as a note via the existing annotate route.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!isAiProviderConfigured()) {
      return NextResponse.json(
        { error: "AI is not configured on this deployment." },
        { status: 503 },
      );
    }

    const consent = await resolveAiConsent(supabase, user.id);
    if (!consent.allowed) {
      if (consent.reason === "unavailable") {
        return NextResponse.json(
          { error: "AI preferences temporarily unavailable." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "Enable AI insights in Settings first." },
        { status: 403 },
      );
    }

    const allowed = await checkRateLimit(`ai-receipt:${user.id}`, 10, 24 * 3600, {
      failClosed: true,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Daily scan limit reached." }, { status: 429 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > MAX_IMAGE_BYTES) return badRequest("Image too large (5 MB max)");
    const mediaType = file.type;
    if (!IMAGE_TYPES.has(mediaType)) return badRequest("Unsupported image type");

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");

    const extractionResult = await extractReceiptWithProvider({
      fileBase64: data,
      mediaType,
    });

    if (extractionResult.refusal || !extractionResult.extracted) {
      return NextResponse.json({ error: "The image could not be processed." }, { status: 422 });
    }
    const extracted = extractionResult.extracted;

    // Match against the ledger within the shared receipt candidate rules.
    let matchedTransactionId: string | null = null;
    if (extracted.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      const from = new Date(extracted.date);
      from.setUTCDate(from.getUTCDate() - 3);
      const to = new Date(extracted.date);
      to.setUTCDate(to.getUTCDate() + 3);
      // Bounded by the same ±1% amount band the matcher applies, so the row
      // cap cannot page the true match out of an unordered result.
      const { data: candidates } = await supabase
        .from("transactions")
        .select("id, date, amount, merchant_name, name")
        .gte("date", from.toISOString().slice(0, 10))
        .lte("date", to.toISOString().slice(0, 10))
        .or(receiptAmountBandFilter(extracted.amount))
        .order("date", { ascending: true })
        .limit(500);
      matchedTransactionId = findReceiptCandidates(
        {
          merchant: extracted.merchant,
          total: extracted.amount,
          purchaseDate: extracted.date,
        },
        ((candidates ?? []) as Array<{
          id: string;
          date: string;
          amount: number;
          merchant_name: string | null;
          name: string | null;
        }>).map((candidate) => ({
          id: candidate.id,
          date: candidate.date,
          amount: Number(candidate.amount),
          merchantName: candidate.merchant_name,
          name: candidate.name,
        })),
      )[0]?.transactionId ?? null;
    }

    await writeAudit({
      userId: user.id,
      action: "receipt_scanned",
      metadata: { matched: Boolean(matchedTransactionId) },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      merchant: extracted.merchant,
      amount: extracted.amount,
      date: extracted.date,
      lineItems: extracted.line_items.slice(0, 15),
      matchedTransactionId,
    });
  } catch (error) {
    return errorResponse("ai.receipt", error);
  }
}
