import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import {
  detectDuplicatePairs,
  duplicateSubjectId,
  type DuplicateTransaction,
  type ReviewDecision,
} from "@/lib/transaction-quality";

const LOOKBACK_DAYS = 180;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const [transactionsResult, accountsResult, decisionsResult, linksResult] = await Promise.all([
      auth.supabase
        .from("transactions")
        .select("id,date,merchant_name,name,amount,account_id")
        .eq("user_id", auth.user.id)
        .gte("date", isoDaysAgo(LOOKBACK_DAYS))
        .limit(5000),
      auth.supabase
        .from("accounts")
        .select("id,name,plaid_item_id")
        .eq("user_id", auth.user.id)
        .limit(5000),
      auth.supabase
        .from("transaction_review_decisions")
        .select("subject_id,decision")
        .eq("user_id", auth.user.id)
        .eq("kind", "duplicate")
        .limit(5000),
      auth.supabase
        .from("linked_duplicates")
        .select("subject_id,kept_transaction_id,excluded_transaction_id")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);
    for (const result of [transactionsResult, accountsResult, decisionsResult, linksResult]) {
      if (result.error) throw result.error;
    }
    const accountById = new Map(
      (accountsResult.data ?? []).map((account) => [
        account.id as string,
        {
          name: (account.name as string | null) ?? "Account",
          plaidItemId: (account.plaid_item_id as string | null) ?? null,
        },
      ]),
    );
    const transactions: DuplicateTransaction[] = (transactionsResult.data ?? []).map((row) => {
      const accountId = row.account_id as string;
      const account = accountById.get(accountId);
      return {
        id: row.id as string,
        date: row.date as string,
        merchant: (row.merchant_name ?? row.name ?? "Unknown") as string,
        amount: Number(row.amount),
        accountId,
        plaidItemId: account?.plaidItemId ?? null,
        accountName: account?.name ?? "Account",
      };
    });
    const decisions: ReviewDecision[] = (decisionsResult.data ?? []).map((row) => ({
      kind: "duplicate",
      subjectId: row.subject_id as string,
      decision: row.decision as ReviewDecision["decision"],
    }));
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const links = linksResult.data ?? [];
    const confirmed = links.map((link) => ({
      subjectId: link.subject_id as string,
      kept: byId.get(link.kept_transaction_id as string) ?? null,
      excluded: byId.get(link.excluded_transaction_id as string) ?? null,
    }));
    // A transaction already on either side of a link cannot take part in a
    // second one — see the unique constraints in the linked_duplicates
    // migration. Withholding it here is what keeps the UI from offering a pair
    // the RPC will refuse.
    const linkedTransactionIds = new Set(
      links.flatMap((link) => [
        link.kept_transaction_id as string,
        link.excluded_transaction_id as string,
      ]),
    );
    return NextResponse.json({
      pairs: detectDuplicatePairs(transactions, decisions, linkedTransactionIds),
      confirmed,
    });
  } catch (error) {
    return errorResponse("transactions.duplicates.list", error);
  }
}

interface DuplicateDecisionBody {
  subjectId: string;
  keptTransactionId: string;
  excludedTransactionId: string;
  decision: "confirmed" | "dismissed";
}

/** Validates the decision payload, returning the ready 400 when it does not hold. */
function parseDecisionBody(
  raw: unknown,
): DuplicateDecisionBody | NextResponse {
  const body = raw as Partial<Record<keyof DuplicateDecisionBody, unknown>> | null;
  if (
    typeof body?.subjectId !== "string" ||
    typeof body.keptTransactionId !== "string" ||
    typeof body.excludedTransactionId !== "string" ||
    (body.decision !== "confirmed" && body.decision !== "dismissed")
  ) {
    return badRequest("subject, transaction ids, and decision are required");
  }
  if (
    body.keptTransactionId === body.excludedTransactionId ||
    body.subjectId !== duplicateSubjectId(body.keptTransactionId, body.excludedTransactionId)
  ) {
    return badRequest("subject does not match the transaction ids");
  }
  return {
    subjectId: body.subjectId,
    keptTransactionId: body.keptTransactionId,
    excludedTransactionId: body.excludedTransactionId,
    decision: body.decision,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = parseDecisionBody(await request.json().catch(() => null));
    if (body instanceof NextResponse) return body;

    const { data: owned, error: ownershipError } = await auth.supabase
      .from("transactions")
      .select("id")
      .eq("user_id", auth.user.id)
      .in("id", [body.keptTransactionId, body.excludedTransactionId]);
    if (ownershipError) throw ownershipError;
    if (new Set((owned ?? []).map((row) => row.id as string)).size !== 2) {
      return NextResponse.json({ error: "Transactions not found" }, { status: 404 });
    }

    const service = createServiceClient();
    if (body.decision === "confirmed") {
      const { error } = await service.rpc("confirm_transaction_duplicate", {
        p_user_id: auth.user.id,
        p_subject_id: body.subjectId,
        p_kept_transaction_id: body.keptTransactionId,
        p_excluded_transaction_id: body.excludedTransactionId,
      });
      // The GET already withholds linked transactions, so this only fires on a
      // stale client or two tabs racing. It is a conflict, not a server fault.
      if (error?.message?.includes("duplicate_link_conflict")) {
        return NextResponse.json(
          { error: "One of these transactions is already linked to another duplicate." },
          { status: 409 },
        );
      }
      if (error) throw error;
    } else {
      const { error } = await service
        .from("transaction_review_decisions")
        .upsert({
          user_id: auth.user.id,
          kind: "duplicate",
          subject_id: body.subjectId,
          decision: "dismissed",
        }, { onConflict: "user_id,kind,subject_id" });
      if (error) throw error;
    }
    await writeAudit({
      userId: auth.user.id,
      action: body.decision === "confirmed" ? "duplicate_confirmed" : "duplicate_dismissed",
      metadata: { subject_id: body.subjectId },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.duplicates.decide", error);
  }
}
