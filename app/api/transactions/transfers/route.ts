import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  detectTransferPairs,
  filterReviewDecisions,
  transferSubjectId,
} from "@/lib/transaction-quality";

const WINDOW_DAYS = 7;
const LOOKBACK_DAYS = 60;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Suggested inter-account transfer pairs (same amount, opposite sign, within
 * a short window, different accounts) awaiting review. Dismissed or already
 * linked pairs are hidden and stay hidden — decisions persist in
 * transaction_review_decisions under kind 'transfer'.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    if (!(await checkRateLimit(`transfers:${user.id}:read`, 60, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const since = isoDaysAgo(LOOKBACK_DAYS);
    const [{ data: txns }, { data: decisions }, { data: linked }] = await Promise.all([
      // Own ledger only: a link is a statement that two rows are one event,
      // which must never span two people's data.
      supabase
        .from("transactions")
        .select("id, date, amount, account_id, manual_account_id")
        .eq("user_id", user.id)
        .gte("date", since)
        .limit(5000),
      supabase
        .from("transaction_review_decisions")
        .select("subject_id, decision")
        .eq("kind", "transfer"),
      supabase.from("linked_transfers").select("out_transaction_id, in_transaction_id"),
    ]);

    const ledger = (txns ?? []).map((row) => ({
      id: row.id as string,
      date: row.date as string,
      merchant: "",
      amount: Number(row.amount),
      accountId: (row.account_id ?? row.manual_account_id ?? "") as string,
    }));
    const byId = new Map(ledger.map((row) => [row.id, row]));

    const alreadyLinked = new Set(
      (linked ?? []).flatMap((row) => [
        `${row.out_transaction_id}:${row.in_transaction_id}`,
        row.out_transaction_id as string,
        row.in_transaction_id as string,
      ]),
    );
    const resolved = new Set((decisions ?? []).map((row) => row.subject_id as string));

    const pairs = detectTransferPairs(ledger, WINDOW_DAYS);
    const visible = filterReviewDecisions(
      pairs.map((pair) => ({
        kind: "transfer" as const,
        subjectId: pair.subjectId,
        message: "",
      })),
      (decisions ?? []).map((row) => ({
        kind: "transfer" as const,
        subjectId: row.subject_id as string,
        decision: row.decision as "confirmed" | "dismissed",
      })),
    ).filter((anomaly) => !resolved.has(anomaly.subjectId) && !alreadyLinked.has(anomaly.subjectId));

    const pairsOut = visible.map((anomaly) => {
      const pair = pairs.find((candidate) => candidate.subjectId === anomaly.subjectId)!;
      const out = byId.get(pair.outId);
      const inbound = byId.get(pair.inId);
      return {
        subject_id: pair.subjectId,
        out_id: pair.outId,
        in_id: pair.inId,
        amount: pair.amount,
        out_date: out?.date ?? null,
        in_date: inbound?.date ?? null,
      };
    });

    return NextResponse.json({ pairs: pairsOut });
  } catch (error) {
    return errorResponse("transactions.transfers", error);
  }
}

async function linkConfirmedTransfer(
  supabase: ReturnType<typeof requireUser> extends Promise<infer R> ? (R extends { supabase: infer S } ? S : never) : never,
  userId: string,
  subjectId: string,
  body: Record<string, unknown> | null,
): Promise<NextResponse | null> {
  const outId = body?.out_id;
  const inId = body?.in_id;
  if (typeof outId !== "string" || typeof inId !== "string") {
    return badRequest("out_id and in_id are required to link a transfer");
  }
  if (outId === inId) {
    return badRequest("a transfer needs two different transactions");
  }
  if (subjectId !== transferSubjectId(outId, inId)) {
    return badRequest("subject_id does not match the pair");
  }
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          in: (col: string, ids: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
      upsert: (values: unknown, opts: unknown) => Promise<{ error: unknown }>;
    };
  };
  // Both sides of a link must be rows in the caller's own ledger.
  const { data: owned, error: verifyError } = await client
    .from("transactions")
    .select("id, amount")
    .eq("user_id", userId)
    .in("id", [outId, inId]);
  if (verifyError) throw verifyError;
  if ((owned ?? []).length !== 2) {
    return badRequest("both sides of a transfer must be your own transactions");
  }
  const outRow = (owned as Array<{ id: string; amount?: number | string | null }>).find((r) => r.id === outId);
  const inRow = (owned as Array<{ id: string; amount?: number | string | null }>).find((r) => r.id === inId);
  if (!outRow || !inRow) {
    return badRequest("both sides of a transfer must be your own transactions");
  }
  const outAmount = Number(outRow.amount);
  const inAmount = Number(inRow.amount);
  if (
    !Number.isFinite(outAmount) ||
    !Number.isFinite(inAmount) ||
    outAmount <= 0 ||
    inAmount >= 0 ||
    Math.round(Math.abs(outAmount) * 100) !== Math.round(Math.abs(inAmount) * 100)
  ) {
    return badRequest("transactions do not form a valid transfer pair");
  }
  const { error: linkError } = await client.from("linked_transfers").upsert(
    {
      user_id: userId,
      out_transaction_id: outId,
      in_transaction_id: inId,
      amount: Math.round(outAmount * 100) / 100,
    },
    { onConflict: "user_id,out_transaction_id,in_transaction_id" },
  );
  if (linkError) throw linkError;
  return null;
}

/** Record a transfer-pair decision; a confirmed pair also nets out via linked_transfers. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await checkRateLimit(`transfers:${user.id}:write`, 30, 3600))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const body = await request.json().catch(() => null);
    const subjectId = body?.subject_id;
    const decision = body?.decision;
    if (typeof subjectId !== "string" || (decision !== "confirmed" && decision !== "dismissed")) {
      return badRequest("subject_id and a valid decision are required");
    }

    if (decision === "confirmed") {
      const linkFailure = await linkConfirmedTransfer(
        supabase as never,
        user.id,
        subjectId,
        body,
      );
      if (linkFailure) return linkFailure;
    }

    const { error: decisionError } = await supabase
      .from("transaction_review_decisions")
      .upsert(
        { user_id: user.id, kind: "transfer", subject_id: subjectId, decision },
        { onConflict: "user_id,kind,subject_id" },
      );
    if (decisionError) throw decisionError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.transfers.post", error);
  }
}
