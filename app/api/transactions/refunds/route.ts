import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectRefundPairs, filterReviewDecisions } from "@/lib/transaction-quality";
import { writeAudit } from "@/lib/audit";

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
  const { supabase, user } = auth;

  try {
    if (!(await checkRateLimit(`refunds:${user.id}:read`, 60, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const since = isoDaysAgo(LOOKBACK_DAYS);
    const [{ data: txns }, { data: decisions }] = await Promise.all([
      // Own ledger only: pairing a charge against a household member's shared
      // refund would link two people's rows into one review decision.
      supabase
        .from("transactions")
        .select("id, date, merchant_name, name, amount")
        .eq("user_id", user.id)
        .gte("date", since)
        .limit(5000),
      supabase
        .from("transaction_review_decisions")
        .select("subject_id, decision")
        .eq("user_id", user.id)
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
      const pair = pairs.find(
        (candidate) => candidate.chargeId === chargeId && candidate.refundId === refundId,
      );
      return {
        subject_id: anomaly.subjectId,
        charge_id: chargeId,
        refund_id: refundId,
        merchant: charge?.merchant ?? "Unknown",
        charge_date: charge?.date ?? null,
        refund_date: refund?.date ?? null,
        amount: charge?.amount ?? 0,
        refund_amount: refund ? Math.abs(refund.amount) : 0,
        partial: pair?.partial ?? false,
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
    if (!(await checkRateLimit(`refunds:${user.id}:write`, 30, 3600))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const body = await request.json().catch(() => null);
    const subjectId = body?.subject_id;
    const decision = body?.decision;
    if (typeof subjectId !== "string" || (decision !== "confirmed" && decision !== "dismissed")) {
      return badRequest("subject_id and a valid decision are required");
    }

    if (decision === "confirmed") {
      const chargeId = body?.charge_id;
      const refundId = body?.refund_id;
      const rawAmount = body?.amount !== undefined ? Number(body.amount) : undefined;
      if (
        typeof chargeId !== "string" ||
        typeof refundId !== "string" ||
        (rawAmount !== undefined && !Number.isFinite(rawAmount))
      ) {
        return badRequest("charge_id, refund_id, and amount are required to link a refund");
      }
      if (chargeId === refundId) {
        return badRequest("a refund link requires two different transactions");
      }
      if (subjectId !== `${chargeId}:${refundId}`) {
        return badRequest("subject_id does not match the charge and refund");
      }

      // Both sides of a link must be rows in the caller's own ledger — an
      // arbitrary transaction_id would forge a netting link against someone
      // else's money.
      const { data: owned, error: verifyError } = await supabase
        .from("transactions")
        .select("id, amount")
        .eq("user_id", user.id)
        .in("id", [chargeId, refundId]);
      if (verifyError) throw verifyError;
      if ((owned ?? []).length !== 2) {
        return badRequest("charge and refund must both be your own transactions");
      }

      const chargeRow = owned?.find((r) => r.id === chargeId);
      const refundRow = owned?.find((r) => r.id === refundId);
      const chargeAmount = Number(chargeRow?.amount);
      const refundAmount = Number(refundRow?.amount);

      if (
        !Number.isFinite(chargeAmount) ||
        !Number.isFinite(refundAmount) ||
        chargeAmount <= 0 ||
        refundAmount >= 0
      ) {
        return badRequest("charge must be positive and refund must be negative");
      }

      // Check amount matching if client supplied an amount
      const targetAmount = rawAmount !== undefined ? Math.abs(rawAmount) : Math.abs(chargeAmount);
      if (
        Math.round(targetAmount * 100) > Math.round(chargeAmount * 100) ||
        Math.round(targetAmount * 100) > Math.round(Math.abs(refundAmount) * 100)
      ) {
        return badRequest("refund amount exceeds the charge or refund transaction total");
      }

      // Check if either transaction is already linked to another refund
      const { data: existingLinks, error: linkCheckError } = await supabase
        .from("linked_refunds")
        .select("charge_transaction_id, refund_transaction_id")
        .eq("user_id", user.id)
        .or(
          `charge_transaction_id.in.(${chargeId},${refundId}),refund_transaction_id.in.(${chargeId},${refundId})`,
        );
      if (linkCheckError) throw linkCheckError;
      if (Array.isArray(existingLinks) && existingLinks.length > 0) {
        const isSelfMatch = existingLinks.every(
          (l) => l.charge_transaction_id === chargeId && l.refund_transaction_id === refundId,
        );
        if (!isSelfMatch) {
          return NextResponse.json(
            { error: "one or both transactions are already linked to another refund" },
            { status: 409 },
          );
        }
      }

      const { error: rpcError } = await supabase.rpc("confirm_refund_link", {
        p_user_id: user.id,
        p_subject_id: subjectId,
        p_charge_id: chargeId,
        p_refund_id: refundId,
        p_amount: Math.round(targetAmount * 100) / 100,
      });
      if (rpcError?.message?.includes("refund_link_conflict")) {
        return NextResponse.json(
          { error: "one or both transactions are already linked to another refund" },
          { status: 409 },
        );
      }
      if (rpcError) throw rpcError;
    } else {
      const { error: decisionError } = await supabase
        .from("transaction_review_decisions")
        .upsert(
          { user_id: user.id, kind: "refund", subject_id: subjectId, decision },
          { onConflict: "user_id,kind,subject_id" },
        );
      if (decisionError) throw decisionError;
    }

    await writeAudit({
      userId: user.id,
      action: decision === "confirmed" ? "refund_confirmed" : "refund_dismissed",
      metadata: { subject_id: subjectId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.refunds.post", error);
  }
}
