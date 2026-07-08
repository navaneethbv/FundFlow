import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { detectRefundPairs, filterReviewDecisions } from "@/lib/transaction-quality";

const WINDOW_DAYS = 14;
const LOOKBACK_DAYS = 90;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Refund pairs (same merchant, opposite sign, close in time) awaiting review. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const since = isoDaysAgo(LOOKBACK_DAYS);
    const [{ data: txns }, { data: decisions }] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, date, merchant_name, name, amount")
        .gte("date", since)
        .limit(5000),
      supabase
        .from("transaction_review_decisions")
        .select("subject_id, decision")
        .eq("kind", "refund"),
    ]);

    const ledger = (txns ?? []).map((row) => ({
      id: row.id as string,
      date: row.date as string,
      merchant: (row.merchant_name ?? row.name ?? "") as string,
      amount: Number(row.amount),
    }));
    const byId = new Map(ledger.map((row) => [row.id, row]));

    const pairs = detectRefundPairs(ledger, WINDOW_DAYS);
    const anomalies = pairs.map((pair) => ({
      kind: "refund" as const,
      subjectId: `${pair.chargeId}:${pair.refundId}`,
      message: "",
    }));
    const decisionRows = (decisions ?? []).map((row) => ({
      kind: "refund" as const,
      subjectId: row.subject_id as string,
      decision: row.decision as "confirmed" | "dismissed",
    }));
    // Drop dismissed pairs (tested helper) and pairs already linked (confirmed).
    const resolved = new Set(decisionRows.map((row) => row.subjectId));
    const visible = filterReviewDecisions(anomalies, decisionRows).filter(
      (anomaly) => !resolved.has(anomaly.subjectId),
    );

    const pairsOut = visible.map((anomaly) => {
      const [chargeId, refundId] = anomaly.subjectId.split(":");
      const charge = byId.get(chargeId!);
      const refund = byId.get(refundId!);
      return {
        subject_id: anomaly.subjectId,
        charge_id: chargeId,
        refund_id: refundId,
        merchant: charge?.merchant ?? "Unknown",
        charge_date: charge?.date ?? null,
        refund_date: refund?.date ?? null,
        amount: charge?.amount ?? 0,
      };
    });

    return NextResponse.json({ pairs: pairsOut });
  } catch (error) {
    return errorResponse("transactions.refunds", error);
  }
}

/** Record a refund-pair decision; a linked pair also nets out via linked_refunds. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const subjectId = body?.subject_id;
    const decision = body?.decision;
    if (typeof subjectId !== "string" || (decision !== "confirmed" && decision !== "dismissed")) {
      return badRequest("subject_id and a valid decision are required");
    }

    const { error: decisionError } = await supabase
      .from("transaction_review_decisions")
      .upsert(
        { user_id: user.id, kind: "refund", subject_id: subjectId, decision },
        { onConflict: "user_id,kind,subject_id" },
      );
    if (decisionError) throw decisionError;

    if (decision === "confirmed") {
      const chargeId = body?.charge_id;
      const refundId = body?.refund_id;
      const amount = Number(body?.amount);
      if (typeof chargeId !== "string" || typeof refundId !== "string" || !Number.isFinite(amount)) {
        return badRequest("charge_id, refund_id, and amount are required to link a refund");
      }
      const { error: linkError } = await supabase.from("linked_refunds").upsert(
        {
          user_id: user.id,
          charge_transaction_id: chargeId,
          refund_transaction_id: refundId,
          amount: Math.abs(amount),
        },
        { onConflict: "user_id,charge_transaction_id,refund_transaction_id" },
      );
      if (linkError) throw linkError;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.refunds.post", error);
  }
}
